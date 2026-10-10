

import {
  createLaunchFlow,
  MANAGED_RUN_IDENTITY_ENFORCEMENT_UNAVAILABLE
} from "./workspace-agent-dispatch-run-lifecycle-launch.mjs";
import { createPlanLaunch } from "./workspace-agent-dispatch-run-lifecycle-selection.mjs";
import { createMonitor } from "./workspace-agent-dispatch-run-lifecycle-monitor.mjs";
import { createAdvisoryProcessRunner } from "./workspace-agent-advisory-process.mjs";
import { subscribeRunCompletion, projectCapturedRunRecord } from "./workspace-agent-dispatch-run-settlement.mjs";
import {
  snapshotRuns as snapshotRunState,
  replaceReviewerLaunchIdentityForTest as replaceReviewerLaunchIdentityState
} from "./workspace-agent-dispatch-run-lifecycle-state.mjs";

export { MANAGED_RUN_IDENTITY_ENFORCEMENT_UNAVAILABLE };

export function createPreparedDispatchRunLifecycle(ctx = {}) {
  return assembleRunLifecycle(ctx, projectCapturedRunRecord);
}

export function createDispatchRunLifecycle(ctx = {}) {
  return assembleRunLifecycle(ctx, null);
}

function assembleRunLifecycle(ctx, projectRunRecord) {
  const {
    executors,
    executorRegistryEntries,
    familyAwareWiring,
    runs,
    clock,
    sleep,
    monotonicNow,
    runIdFactory,
    monitorHandleFactory,
    evaluateWorkerAdmission = null,

    freezeWorkerScopeSnapshot = null,
    validateWorkerScopeSnapshot = null,

    deriveReviewerLaunchIdentity = null,

    proveAssignedSourceReadable = null,
    captureSliceReviewTerminalResult = null,
    settleFormalReviewAttestation = null,

    managedWorkerIdentityRequired = false,
    managedRunIdentityRootPresent = false,
    checkPriorManagedAttempt = null,
    publishPendingManagedRunIdentity = null,
    bindManagedRunOuterIdentity = null,

    releaseManagedRunSubjectReservationForLaunch = null,

    resolveCanonicalAdmissionReviewRecord = null,
    publishManagedRunResult = null
  } = ctx;

  const assessManagedRunResult = projectRunRecord === null ? null : ctx.assessManagedRunResult ?? null;
  if (projectRunRecord !== null && typeof publishManagedRunResult === "function" &&
      typeof assessManagedRunResult !== "function") {
    throw new TypeError("prepared publication requires authenticated assessment and publisher dependencies");
  }
  const onLaunchCompletion = (record, completion) => subscribeRunCompletion(record, completion, {
    clock, captureSliceReviewTerminalResult, settleFormalReviewAttestation, publishManagedRunResult,
    assessManagedRunResult, projectRunRecord, captureRunOriginal: ctx.captureRunOriginal ?? null,
    publishManagedRunOriginal: ctx.publishManagedRunOriginal ?? null,
    publishManagedReviewOriginal: ctx.publishManagedReviewOriginal ?? null
  });
  const { startLaunch, startReviewerReplacement } = createLaunchFlow({
    executors,
    executorRegistryEntries,
    familyAwareWiring,
    runs,
    clock,
    runIdFactory,
    monitorHandleFactory,
    evaluateWorkerAdmission,
    freezeWorkerScopeSnapshot,
    validateWorkerScopeSnapshot,
    deriveReviewerLaunchIdentity,
    proveAssignedSourceReadable,
    captureSliceReviewTerminalResult,
    settleFormalReviewAttestation,
    managedWorkerIdentityRequired,
    managedRunIdentityRootPresent,
    checkPriorManagedAttempt,
    publishPendingManagedRunIdentity,
    bindManagedRunOuterIdentity,
    releaseManagedRunSubjectReservationForLaunch,
    resolveCanonicalAdmissionReviewRecord,
    publishManagedRunResult,
    assessManagedRunResult,
    projectRunRecord,
    onLaunchCompletion
  });

  const { getRunStatus, waitForRunStatus, resolveRetainedFindingsSource } = createMonitor({
    runs,
    clock,
    sleep,
    monotonicNow,
    captureSliceReviewTerminalResult,
    settleFormalReviewAttestation,
    publishManagedRunResult,
    projectRunRecord
  });

  const startAdvisoryProcess = createAdvisoryProcessRunner({
    executors,
    executorRegistryEntries,
    familyAwareWiring,
    runs,
    clock,
    runIdFactory,
    monitorHandleFactory,
    settleFormalReviewAttestation,
    captureTerminalOriginal: projectRunRecord !== null && typeof ctx.captureRunOriginal === "function",
    onLaunchCompletion
  });

  const planLaunch = createPlanLaunch({ executors });

  return {
    startLaunch,
    startAdvisoryProcess,
    startReviewerReplacement,
    getRunStatus,
    waitForRunStatus,
    resolveRetainedFindingsSource,
    planLaunch,
    snapshotRuns: () => snapshotRunState(runs),
    replaceReviewerLaunchIdentityForTest: (runId, identity) =>
      replaceReviewerLaunchIdentityState(runs, runId, identity)
  };
}
