

import {
  createLaunchFlow,
  MANAGED_RUN_IDENTITY_ENFORCEMENT_UNAVAILABLE
} from "./workspace-agent-dispatch-run-lifecycle-launch.mjs";
import { createPlanLaunch } from "./workspace-agent-dispatch-run-lifecycle-selection.mjs";
import { createMonitor } from "./workspace-agent-dispatch-run-lifecycle-monitor.mjs";
import { createAdvisoryProcessRunner } from "./workspace-agent-advisory-process.mjs";
import {
  listVisibleRuns,
  snapshotRuns as snapshotRunState,
  replaceReviewerLaunchIdentityForTest as replaceReviewerLaunchIdentityState
} from "./workspace-agent-dispatch-run-lifecycle-state.mjs";

export { MANAGED_RUN_IDENTITY_ENFORCEMENT_UNAVAILABLE };

export function createDispatchRunLifecycle(ctx = {}) {
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

    resolveCanonicalAdmissionReviewRecord = null
  } = ctx;

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
    resolveCanonicalAdmissionReviewRecord
  });

  const { getRunStatus, waitForRunStatus } = createMonitor({
    runs,
    clock,
    sleep,
    monotonicNow,
    captureSliceReviewTerminalResult,
    settleFormalReviewAttestation
  });

  const startAdvisoryProcess = createAdvisoryProcessRunner({
    executors,
    executorRegistryEntries,
    familyAwareWiring,
    runs,
    clock,
    runIdFactory,
    monitorHandleFactory,
    settleFormalReviewAttestation
  });

  const planLaunch = createPlanLaunch({ executors });

  return {
    startLaunch,
    startAdvisoryProcess,
    startReviewerReplacement,
    listRuns: (input) => listVisibleRuns(runs, input),
    getRunStatus,
    waitForRunStatus,
    planLaunch,
    snapshotRuns: () => snapshotRunState(runs),
    replaceReviewerLaunchIdentityForTest: (runId, identity) =>
      replaceReviewerLaunchIdentityState(runs, runId, identity)
  };
}
