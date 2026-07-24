

import {
  createLaunchFlow,
  MANAGED_RUN_IDENTITY_ENFORCEMENT_UNAVAILABLE
} from "./workspace-agent-dispatch-run-lifecycle-launch.mjs";
import { createPlanLaunch } from "./workspace-agent-dispatch-run-lifecycle-selection.mjs";
import { createMonitor } from "./workspace-agent-dispatch-run-lifecycle-monitor.mjs";
import {
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
    captureSliceReviewTerminalResult = null
    ,resolveCorrectiveFindingsContext = null,

    managedWorkerIdentityRequired = false,
    managedRunIdentityRootPresent = false,
    checkPriorManagedAttempt = null,
    publishPendingManagedRunIdentity = null,
    bindManagedRunOuterIdentity = null,

    releaseManagedRunSubjectReservationForLaunch = null
  } = ctx;

  const { startLaunch } = createLaunchFlow({
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
    resolveCorrectiveFindingsContext,
    managedWorkerIdentityRequired,
    managedRunIdentityRootPresent,
    checkPriorManagedAttempt,
    publishPendingManagedRunIdentity,
    bindManagedRunOuterIdentity,
    releaseManagedRunSubjectReservationForLaunch
  });

  const { getRunStatus, waitForRunStatus } = createMonitor({
    runs,
    clock,
    sleep,
    monotonicNow,
    captureSliceReviewTerminalResult
  });

  const planLaunch = createPlanLaunch({ executors });

  return {
    startLaunch,
    getRunStatus,
    waitForRunStatus,
    planLaunch,
    snapshotRuns: () => snapshotRunState(runs),
    replaceReviewerLaunchIdentityForTest: (runId, identity) =>
      replaceReviewerLaunchIdentityState(runs, runId, identity)
  };
}
