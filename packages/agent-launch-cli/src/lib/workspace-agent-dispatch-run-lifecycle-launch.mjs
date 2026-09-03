

import {
  BACKEND_REFUSAL_CODES,
  MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES,
  MANAGED_CORRECTIVE_OBSERVED_STATUS_FIELDS,
  MANAGED_CORRECTIVE_RECOVERY_FIELDS,
  MANAGED_CORRECTIVE_RECOVERY_OBSERVED_FIELDS,
  MANAGED_CORRECTIVE_STATUSES,
  MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND,
  MANAGED_CORRECTIVE_STATUS_VALUES
} from "@agent-chassis/agent-launch-core";
import {
  LAUNCHER_DURABLE_STATE_CODES
} from "@agent-chassis/agent-launch-core/src/lib/durable-runtime-state.mjs";
import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  CACHE_ROOT_SUFFIX,
  compiledValidatorCacheRoot,
  prepareCompiledValidatorCache
} from "@agent-chassis/controlled-contract/validator-cache";
import { dispatchRefusal } from "./workspace-agent-dispatch-refusal.mjs";
import { resolveWorkerSourceAccess } from "./workspace-agent-dispatch-source-access.mjs";
import { bindReviewerValidationEvidence } from "./terminal-wk-candidate-validation.mjs";
import {
  classifyLauncherFindingsCompletionTransport,
  LAUNCHER_FINDINGS_COMPLETION_TRANSPORTS
} from "./workspace-agent-role-contract.mjs";
import {
  captureLauncherAgentSessionContract
} from "./stdio-mcp-conduit-authority.mjs";
import {
  appendLauncherFindingsExecutionBinds,
  mintLauncherFindingsLifecycleContext,
  selectLauncherLifecycleFromEffectiveWriteScope
} from "./workspace-agent-findings-lifecycle-context.mjs";
import { resolveLaunchSelection } from "./workspace-agent-dispatch-run-lifecycle-selection.mjs";
import {
  allocateLauncherTransitionPlan,
  createProspectiveLauncherTransitionPlan,
  LAUNCHER_TRANSITION_FAILURES,
  projectLauncherTransitionOwnerSettlement,
  revalidateLauncherTransitionPlan
} from "./launcher-transition-plan.mjs";
import {
  isPlainObject,
  discardPendingManagedRunIdentity,
  finalizeLaunchOutcome
} from "./workspace-agent-dispatch-run-lifecycle-settlement.mjs";
import {
  CANONICAL_INTEGRATED_LIFECYCLE_STATE_IMPOSSIBLE_CODE
} from "./backend-integrated-scope-authority.mjs";

export const MANAGED_RUN_IDENTITY_ENFORCEMENT_UNAVAILABLE =
  "managed_run_identity_enforcement_unavailable";

const GENERIC_MANAGED_IDENTITY_CHECK_MESSAGE =
  "managed identity check failed";
const ORIGINATING_CODE_STATUS_UNAVAILABLE = "unavailable";
const ORIGINATING_CODE_STATUS_INVALID = "invalid";
const RECOVERY_CARRIER_STATUS_ABSENT = "absent";
const RECOVERY_CARRIER_STATUS_MALFORMED = "malformed";
const MAX_DIAGNOSTIC_CODE_LENGTH = 128;
const DOTTED_DIAGNOSTIC_CODE_PATTERN =
  /^(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)*\.){2,}v[1-9][0-9]*$/u;
const BARE_DIAGNOSTIC_CODE_PATTERN =
  /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/u;
const SOURCE_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u;

function isBoundedCode(value, pattern) {
  return value.length <= MAX_DIAGNOSTIC_CODE_LENGTH && pattern.test(value);
}

function isStableDiagnosticCode(value) {
  return isBoundedCode(value, DOTTED_DIAGNOSTIC_CODE_PATTERN) ||
    isBoundedCode(value, BARE_DIAGNOSTIC_CODE_PATTERN);
}

function isStableSourceCode(value) {
  return typeof value === "string" && isBoundedCode(value, SOURCE_CODE_PATTERN);
}

function isClosedStatus(value) {
  return typeof value === "string" && MANAGED_CORRECTIVE_STATUS_VALUES.includes(value);
}

function isCanonicalId(value, prefix) {
  return typeof value === "string" && new RegExp(`^${prefix}-\\d+$`, "u").test(value);
}

function hasExactKeys(object, keys) {
  const actual = Object.keys(object).sort();
  return actual.length === keys.length && keys.every((key, index) => actual[index] === key);
}

function projectObservedCanonicalStatus(source) {
  const observed = source?.observed_canonical_status;
  if (observed === null || typeof observed !== "object" || Array.isArray(observed)) return null;
  if (!hasExactKeys(observed, MANAGED_CORRECTIVE_OBSERVED_STATUS_FIELDS)) {
    return null;
  }
  if (!isCanonicalId(observed.record_id, "WK") ||
      !isCanonicalId(observed.slice_id, "SLICE") ||
      !isClosedStatus(observed.parent_status) ||
      !isClosedStatus(observed.slice_status)) return null;
  return Object.freeze({
    record_id: observed.record_id,
    slice_id: observed.slice_id,
    parent_status: observed.parent_status,
    slice_status: observed.slice_status
  });
}

function projectRecovery(source, observed) {
  const recovery = source?.recovery;
  if (recovery === null || typeof recovery !== "object" || Array.isArray(recovery)) return null;
  if (!hasExactKeys(recovery, MANAGED_CORRECTIVE_RECOVERY_FIELDS)) return null;
  const observedTuple = recovery.observed;
  if (observedTuple === null || typeof observedTuple !== "object" || Array.isArray(observedTuple) ||
      !hasExactKeys(observedTuple, MANAGED_CORRECTIVE_RECOVERY_OBSERVED_FIELDS) ||
      recovery.recovery_kind !== MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND ||
      recovery.responsible_actor !== "launcher" ||
      recovery.next_action !== "retry_workspace_agent_run_status_same_monitor_and_subject" ||
      recovery.unit !== observed.record_id ||
      recovery.slice_unit !== `${observed.record_id}#${observed.slice_id}` ||
      recovery.exact_subject !== recovery.slice_unit ||
      typeof recovery.monitor_handle !== "string" || recovery.monitor_handle.length === 0 ||
      recovery.launcher_retirement_required !== true ||
      recovery.filesystem_cleanup_forbidden !== true ||
      recovery.preserve_substantive_review !== true ||
      recovery.preserve_review_status !== true ||
      recovery.replacement_review_required !== false ||
      typeof recovery.notification !== "string" ||
      observedTuple.parent_status !== observed.parent_status ||
      observedTuple.slice_status !== observed.slice_status) return null;
  return Object.freeze({
    recovery_kind: MANAGED_CORRECTIVE_STATUS_RECOVERY_KIND,
    observed: Object.freeze({
      parent_status: observedTuple.parent_status,
      slice_status: observedTuple.slice_status
    }),
    unit: recovery.unit,
    slice_unit: recovery.slice_unit,
    exact_subject: recovery.exact_subject,
    monitor_handle: recovery.monitor_handle,
    responsible_actor: "launcher",
    next_action: recovery.next_action,
    launcher_retirement_required: true,
    filesystem_cleanup_forbidden: true,
    preserve_substantive_review: true,
    preserve_review_status: true,
    replacement_review_required: false,
    notification: recovery.notification
  });
}

export function projectManagedIdentityCheckFailure(error) {
  const detail = { message: GENERIC_MANAGED_IDENTITY_CHECK_MESSAGE };
  let originatingCode;
  try {
    originatingCode = error?.code;
  } catch {
    originatingCode = null;
  }
  if (typeof originatingCode === "string" && isStableDiagnosticCode(originatingCode)) {
    detail.code = originatingCode;
  } else if (typeof originatingCode === "string") {
    detail.originating_code_status = ORIGINATING_CODE_STATUS_INVALID;
  } else {
    detail.originating_code_status = ORIGINATING_CODE_STATUS_UNAVAILABLE;
  }
  let source;
  try {
    source = error?.detail ?? null;
    const sourceCode = source !== null && typeof source === "object" && !Array.isArray(source)
      ? source.source_code
      : null;
    if (isStableSourceCode(sourceCode)) {
      detail.source_code = sourceCode;
    }
    if (source === null || typeof source !== "object" || Array.isArray(source) ||
        (error?.code !==
            MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED &&
          error?.code !==
            MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.REVIEWED_TARGET_MISMATCH &&
          error?.code !==
            MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.RECEIPTS_CONTRADICTORY)) {
      return Object.freeze(detail);
    }

    if (error.code ===
          MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.REVIEWED_TARGET_MISMATCH ||
        error.code ===
          MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.RECEIPTS_CONTRADICTORY) {
      return Object.freeze({ message: GENERIC_MANAGED_IDENTITY_CHECK_MESSAGE, code: error.code });
    }
    if (source.cause_code !== CANONICAL_INTEGRATED_LIFECYCLE_STATE_IMPOSSIBLE_CODE) {
      return Object.freeze(detail);
    }
    const observed = projectObservedCanonicalStatus(source);
    if (observed === null) return Object.freeze(detail);
    detail.code =
      MANAGED_CORRECTIVE_CONTINUATION_DIAGNOSTIC_CODES.INTEGRATED_STATE_UNRESOLVED;
    detail.cause_code = CANONICAL_INTEGRATED_LIFECYCLE_STATE_IMPOSSIBLE_CODE;
    detail.observed_canonical_status = observed;
    const recovery = projectRecovery(source, observed);

    const actionable = observed.parent_status === MANAGED_CORRECTIVE_STATUSES.TODO &&
      observed.slice_status === MANAGED_CORRECTIVE_STATUSES.TODO;
    if (recovery === null &&
        (Object.hasOwn(source, "recovery") || actionable)) {
      detail.recovery_carrier_status = Object.hasOwn(source, "recovery")
        ? RECOVERY_CARRIER_STATUS_MALFORMED
        : RECOVERY_CARRIER_STATUS_ABSENT;
      return Object.freeze(detail);
    }
    if (recovery !== null) detail.recovery = recovery;
  } catch {
    return Object.freeze(detail);
  }
  return Object.freeze(detail);
}

function validatorCacheBackingError(code, message, details = null) {
  return Object.assign(new Error(message), { code, details });
}

function isContainedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && !path.isAbsolute(relative) &&
    relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

function assertOwnedReadOnlyValidatorCachePath(candidate, root) {
  let entry;
  let resolved;
  try {
    entry = lstatSync(candidate);
    resolved = realpathSync(candidate);
  } catch (error) {
    throw validatorCacheBackingError(
      "validator_cache_unavailable",
      "compiled-validator cache backing is unavailable",
      { path: candidate, cause_code: error?.code ?? null }
    );
  }
  const launcherUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (!entry.isDirectory() || entry.isSymbolicLink() || resolved !== candidate ||
      (launcherUid !== null && entry.uid !== launcherUid) || (entry.mode & 0o002) !== 0 ||
      (candidate !== root && !isContainedPath(root, candidate))) {
    throw validatorCacheBackingError(
      "validator_cache_containment_violation",
      "compiled-validator cache backing is redirected, writable, or not launcher-owned",
      { path: candidate, cache_root: root }
    );
  }
}

function prepareStandaloneValidatorCacheMountpoint(workspaceDir) {
  const launcherUid = typeof process.getuid === "function" ? process.getuid() : null;
  let current = workspaceDir;
  for (const segment of CACHE_ROOT_SUFFIX.slice(0, -1)) {
    current = path.join(current, segment);
    let entry;
    try {
      entry = lstatSync(current);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw validatorCacheBackingError(
          "validator_cache_containment_violation",
          "compiled-validator cache mountpoint parent could not be inspected",
          { path: current, cause_code: error?.code ?? null }
        );
      }
      mkdirSync(current, { mode: 0o700 });
      entry = lstatSync(current);
    }
    if (!entry.isDirectory() || entry.isSymbolicLink() || realpathSync(current) !== current ||
        (launcherUid !== null && entry.uid !== launcherUid) || (entry.mode & 0o002) !== 0) {
      throw validatorCacheBackingError(
        "validator_cache_containment_violation",
        "compiled-validator cache mountpoint parent is redirected or not launcher-owned",
        { path: current }
      );
    }
  }
}

export function standaloneValidatorCacheBinds({ ensured, verified, workspaceDir }) {
  const packageRoot = path.resolve(compiledValidatorCacheRoot());
  if (ensured?.cache_root !== packageRoot || verified?.cache_root !== packageRoot ||
      ensured?.toolchain_digest !== verified?.toolchain_digest ||
      verified?.mode !== "verify" || verified?.result !== "hit" ||
      !/^[0-9a-f]{64}$/u.test(verified?.toolchain_digest ?? "") ||
      !Array.isArray(verified?.groups) || verified.groups.length === 0 ||
      verified.group_count !== verified.groups.length ||
      verified.groups.some((group) => group?.result !== "hit")) {
    throw validatorCacheBackingError(
      "validator_cache_unavailable",
      "compiled-validator cache backing did not verify against the package-owned identity"
    );
  }
  assertOwnedReadOnlyValidatorCachePath(packageRoot, packageRoot);
  const sourceParent = path.join(packageRoot, verified.toolchain_digest);
  if (verified.directory !== sourceParent) {
    throw validatorCacheBackingError(
      "validator_cache_containment_violation",
      "compiled-validator cache artifact root does not match its verified identity"
    );
  }
  assertOwnedReadOnlyValidatorCachePath(sourceParent, packageRoot);
  for (const group of verified.groups) {
    if (path.dirname(group.directory) !== sourceParent ||
        path.basename(group.directory).startsWith(".")) {
      throw validatorCacheBackingError(
        "validator_cache_containment_violation",
        "compiled-validator cache group escaped its verified artifact root",
        { path: group?.directory ?? null }
      );
    }
    assertOwnedReadOnlyValidatorCachePath(group.directory, packageRoot);
  }

  prepareStandaloneValidatorCacheMountpoint(workspaceDir);
  return Object.freeze([Object.freeze({
    src: packageRoot,
    dst: path.join(workspaceDir, ...CACHE_ROOT_SUFFIX)
  })]);
}

export function createLaunchFlow(deps = {}) {
  const {
    executors,
    executorRegistryEntries,
    familyAwareWiring,
    runs,
    clock,
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

    releaseManagedRunSubjectReservationForLaunch = null
  } = deps;
  const bootstrapManagedWkLifecycle =
    typeof freezeWorkerScopeSnapshot?.bootstrapManagedWkLifecycle === "function"
      ? freezeWorkerScopeSnapshot.bootstrapManagedWkLifecycle
      : null;
  const authenticateManagedWkTip =
    typeof freezeWorkerScopeSnapshot?.authenticateManagedWkTip === "function"
      ? freezeWorkerScopeSnapshot.authenticateManagedWkTip
      : null;

  const managedWorkerRequiresIdentityReconciliation = (role) =>
    role === "worker" && managedWorkerIdentityRequired === true;

  function assertManagedWorkerIdentityEnforceable(role, subject) {
    if (!managedWorkerRequiresIdentityReconciliation(role)) return null;
    const missing = [];
    if (managedRunIdentityRootPresent !== true) missing.push("managed_run_identity_root");
    if (typeof checkPriorManagedAttempt !== "function") missing.push("prior_attempt_resolver");
    if (typeof publishPendingManagedRunIdentity !== "function") missing.push("pending_identity_publisher");
    if (typeof bindManagedRunOuterIdentity !== "function") missing.push("outer_identity_binder");
    if (missing.length === 0) return null;
    return dispatchRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      MANAGED_RUN_IDENTITY_ENFORCEMENT_UNAVAILABLE,
      {
        subject,
        role,
        missing_dependencies: Object.freeze([...missing]),
        remediation: "compose the managed dispatch backend with a resolved managed-run identity root"
      }
    );
  }

  async function startLaunch(input = {}) {
    const reservationHolder = { reservation: null, retain: false, subject: null };
    let result;
    try {
      result = await startLaunchWithSubjectReservation(input, reservationHolder);
    } catch (error) {
      await releaseSubjectReservation(reservationHolder);
      throw error;
    }
    if (result?.accepted !== true) await releaseSubjectReservation(reservationHolder);
    return result;
  }

  async function releaseSubjectReservation(holder) {
    if (holder.reservation === null || holder.retain === true) return;
    const reservation = holder.reservation;
    holder.reservation = null;
    if (typeof releaseManagedRunSubjectReservationForLaunch !== "function") return;
    try {
      await releaseManagedRunSubjectReservationForLaunch(reservation);
    } catch {

    }
  }

  async function startLaunchWithSubjectReservation(
    input = {},
    reservationHolder = { reservation: null }
  ) {
    const {
      caller_session_id = null,
      role = null,
      subject = null,
      workspace_alias = null,
      workspace_dir = null,

      config_root_dir = null,

      trusted_frozen_review_contract = null,

      canonical_unit_write_scope,

      launcher_transition_plan: registeredTransitionPlan = null,

      reviewer_dependency_binds = null,
      findings_source_selection = null,
      readiness = null,
      app: requestedApp = null,
      model: requestedModel = null
    } = input;

    let lifecycleKind;
    try {
      lifecycleKind = selectLauncherLifecycleFromEffectiveWriteScope(
        canonical_unit_write_scope
      );
    } catch (error) {
      return dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        error?.code ?? "launcher_effective_write_scope_invalid",
        Object.freeze({
          subject,
          authority_limb: "mechanical_failure",
          scope_present: canonical_unit_write_scope !== null &&
            canonical_unit_write_scope !== undefined,
          scope_is_array: Array.isArray(canonical_unit_write_scope),
          scope_is_frozen: Array.isArray(canonical_unit_write_scope)
            ? Object.isFrozen(canonical_unit_write_scope)
            : false
        })
      );
    }
    const findingsLifecycle = lifecycleKind === "findings";
    let findingsLifecycleContext = null;
    if (findingsLifecycle) {
      try {
        findingsLifecycleContext = mintLauncherFindingsLifecycleContext({
          effectiveWriteScope: canonical_unit_write_scope,
          canonicalMetadataRoot: config_root_dir,
          reviewMaterializationRoot: workspace_dir,
          readinessBinding: readiness,
          trustedFrozenReviewContract: trusted_frozen_review_contract,
          sourceSelectionCarrier: findings_source_selection,
          selectedUnit: subject,
          subject,
          reviewerDependencyBinds: Array.isArray(reviewer_dependency_binds) &&
              Object.isFrozen(reviewer_dependency_binds)
            ? reviewer_dependency_binds
            : Object.freeze([])
        });
      } catch (error) {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          error?.code ?? "launcher_findings_lifecycle_context_invalid",
          {
            subject,
            lifecycle: lifecycleKind,
            authority_limb: "mechanical_failure",
            message: error?.message ?? String(error)
          }
        );
      }
    }

    const completionTransport = classifyLauncherFindingsCompletionTransport({
      role,
      canonicalRepo: config_root_dir
    });

    const selection = resolveLaunchSelection({
      role,
      subject,
      caller_session_id,
      app: requestedApp,
      model: requestedModel,
      workspace_dir,
      config_root_dir,
      executors,
      executorRegistryEntries,
      familyAwareWiring
    });
    if (!selection.ok) return selection.refusal;
    const {
      app,
      routeKind,
      applicable,
      resolvedModel,
      resolvedBackend,
      resolvedBackendProfile,
      resolvedDefaultEffort,
      familyExecutor,
      familyExecutorRegistryEntry
    } = selection;

    const completionCredential = null;
    const transitionSelection = selection;
    if (registeredTransitionPlan !== null && !revalidateLauncherTransitionPlan(
      registeredTransitionPlan,
      { subject, selection: transitionSelection, phase: "prospective" }
    )) {
      return dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "launcher_transition_plan_identity_mismatch",
        { subject, role, authority_limb: "mechanical_failure" }
      );
    }
    let activeTransitionPlan = findingsLifecycle
      ? null
      : registeredTransitionPlan ?? createProspectiveLauncherTransitionPlan({
          subject, selection: transitionSelection, readiness,
          findingsRouteAdmission: null
        });

    const identityEnforcementRefusal = assertManagedWorkerIdentityEnforceable(role, subject);
    if (identityEnforcementRefusal) return identityEnforcementRefusal;

    if (role === "worker" && typeof checkPriorManagedAttempt === "function") {
      let priorAttempt;
      try {
        priorAttempt = await checkPriorManagedAttempt({ role, subject });
      } catch (error) {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "managed_run_identity_check_threw",
          projectManagedIdentityCheckFailure(error)
        );
      }
      if (!priorAttempt || typeof priorAttempt !== "object") {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "managed_run_identity_check_no_result",
          null
        );
      }
      const forbiddenFindingsAuthority = [
        "trusted_corrective_findings_context",
        "launcher_exact_review_receipt",
        "corrective_continuation_proof",
        "receipt_derived_continuation_proof",
        "findings_triggered_reopening",
        "findings_triggered_supersession",
        "findings_derived_refusal"
      ].find((field) => Object.prototype.hasOwnProperty.call(priorAttempt, field));
      if (forbiddenFindingsAuthority !== undefined) {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "findings_state_cannot_control_implementation",
          { subject, field: forbiddenFindingsAuthority }
        );
      }
      if (priorAttempt.may_launch !== true) {

        const priorTuple = priorAttempt.tuple ?? null;
        const committedReview = priorAttempt.committed_review_continuation === true;
        const continuation = priorTuple !== null
          ? Object.freeze({
              kind: committedReview ? "committed_review" : priorAttempt.verdict,
              subject,
              run_id: priorTuple.run_id ?? null,
              monitor_handle: priorTuple.launch_ref ?? null,

              next_action: committedReview
                ? "dispatch_reviewer_for_committed_slice"
                : "reissue_subject_dispatch_when_current_attempt_settles"
            })
          : null;
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          `managed_run_prior_attempt_${priorAttempt.verdict}`,
          {
            subject,
            verdict: priorAttempt.verdict ?? null,
            verdict_reason: priorAttempt.reason ?? null,
            liveness: priorAttempt.liveness ?? null,
            prior_tuple: priorTuple,

            continuation,

            reservation_holder: priorAttempt.holder ?? null,

            recovery_route: committedReview
              ? (priorAttempt.review_route ?? "workspace_agent_dispatch(role=reviewer)")
              : "workspace_agent_dispatch"
          }
        );
      }

      reservationHolder.subject = subject;
      reservationHolder.reservation = priorAttempt.reservation ?? null;
    }

    let frozenWorkerScopeSnapshot = null;
    let managedWkAllocation = null;
    let managedBootstrapComplete = false;
    let settledTransitionPlan = null;
    const settleLauncherTransitionPlan = (settlementFacts) => {
      activeTransitionPlan = allocateLauncherTransitionPlan(activeTransitionPlan, {
        subject, selection: transitionSelection, readiness,
        findingsRouteAdmission: null,
        plannedBase: settlementFacts.planned_base,
        settlement: settlementFacts.settlement,
        dependencyEvidence: settlementFacts.dependency_evidence,
        publicationIdentities: settlementFacts.publication_identities,
        reservationState: reservationHolder.reservation === null ? "not_required" : "held"
      });
      settledTransitionPlan = activeTransitionPlan;
    };
    const attachTransitionPlan = (outcome) => {
      if (findingsLifecycle) return outcome;
      if (!managedBootstrapComplete && outcome?.accepted !== true) return outcome;
      if (outcome?.accepted === true && activeTransitionPlan.phase !== "allocated") {
        settleLauncherTransitionPlan({
          planned_base: null, settlement: null, dependency_evidence: null,
          publication_identities: []
        });
      }
      return Object.freeze({
        ...outcome,
        launcher_transition_plan: activeTransitionPlan,
        ...(settledTransitionPlan === null || settledTransitionPlan === activeTransitionPlan
          ? {}
          : { settled_launcher_transition_plan: settledTransitionPlan }),
        ...(managedWkAllocation === null
          ? {}
          : { managed_wk_allocation: managedWkAllocation }),
      });
    };
    const postBootstrapRefusal = (...args) =>
      attachTransitionPlan(dispatchRefusal(...args));
    const run_id = runIdFactory();
    const monitor_handle = monitorHandleFactory();
    let managedWkLifecycleTicket = null;
    if (!findingsLifecycle && bootstrapManagedWkLifecycle !== null) {
      let bootstrap;
      try {
        bootstrap = await bootstrapManagedWkLifecycle({
          input: {
            ...input,
            launcher_transition_plan: activeTransitionPlan,
            settle_launcher_transition_plan: settleLauncherTransitionPlan
          },
          app,
          role,
          subject,
          run_id,
          monitor_handle
        });
      } catch (error) {
        return dispatchRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "managed_wk_lifecycle_bootstrap_threw",
          {
            cause: Object.freeze({
              type: "managed_wk_bootstrap_failure",
              code: typeof error?.code === "string" &&
                  /^[a-z][a-z0-9_.-]{0,159}$/u.test(error.code)
                ? error.code
                : null
            }),
            recovery: Object.freeze({ state: "no_supported_route", route: null })
          }
        );
      }
      if (bootstrap?.ok !== true) {
        const refusal = bootstrap?.refusal ?? {};
        return dispatchRefusal(
          refusal.code ?? BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          refusal.reason ?? "managed_wk_lifecycle_bootstrap_failed",
          refusal.detail ?? { subject, role }
        );
      }
      managedWkLifecycleTicket = bootstrap.worker_provisioning_ticket ?? null;
      managedWkAllocation = bootstrap.readiness_allocation ?? null;
      managedBootstrapComplete = managedWkAllocation !== null;
    }
    if (role === "worker" && typeof freezeWorkerScopeSnapshot === "function") {
      let freezeResult;
      try {
        freezeResult = await freezeWorkerScopeSnapshot({
          input: {
            ...input,
            launcher_transition_plan: activeTransitionPlan,
            settle_launcher_transition_plan: settleLauncherTransitionPlan
          },
          app,
          role,
          subject,
          run_id,
          monitor_handle,
          managed_wk_lifecycle_ticket: managedWkLifecycleTicket,
          workspace_dir: workspace_dir ?? null
        });
      } catch (error) {
        return postBootstrapRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "worker_scope_snapshot_freeze_threw",
          { message: error?.message ?? String(error) }
        );
      }
      if (!freezeResult?.ok) {
        const refusal = freezeResult?.refusal ?? {};
        return postBootstrapRefusal(
          refusal.code ?? BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          refusal.reason ?? "worker_scope_snapshot_freeze_failed",
          refusal.detail ?? null
        );
      }
      frozenWorkerScopeSnapshot = freezeResult.snapshot ?? null;
      if (frozenWorkerScopeSnapshot !== null && activeTransitionPlan.phase !== "allocated") {
        return postBootstrapRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED.code,
          { subject, role,
            authority_limb: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED.authority_limb,
            next_action: LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED.next_action }
        );
      }
    }

    const validateFrozenWorkerScope = async (consumer, result = null) => {
      if (frozenWorkerScopeSnapshot === null || typeof validateWorkerScopeSnapshot !== "function") {
        return null;
      }
      let validation;
      try {
        validation = await validateWorkerScopeSnapshot({
          snapshot: frozenWorkerScopeSnapshot,
          consumer,
          result
        });
      } catch (error) {
        return postBootstrapRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "worker_scope_snapshot_validation_threw",
          { consumer, message: error?.message ?? String(error) }
        );
      }
      if (validation?.ok) return null;
      const refusal = validation?.refusal ?? {};
      return postBootstrapRefusal(
        refusal.code ?? BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        refusal.reason ?? "worker_scope_snapshot_validation_failed",
        refusal.detail ?? { consumer }
      );
    };

    let workerAdmissionDiagnostic = null;
    if (role === "worker" && typeof evaluateWorkerAdmission === "function") {
      let admissionOutcome;
      try {
        admissionOutcome = await evaluateWorkerAdmission({
          workspaceDir: workspace_dir ?? null,
          subject,

          canonical_work_record: frozenWorkerScopeSnapshot?.record ?? null,
          canonical_selected_unit: frozenWorkerScopeSnapshot?.selected_unit_contract ?? null,
          source_record_digest: frozenWorkerScopeSnapshot?.authority?.source_digest ?? null,
          worker_scope_authority: frozenWorkerScopeSnapshot?.authority ?? null
        });
      } catch (error) {
        return postBootstrapRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "worker_admission_threw",
          { message: error?.message ?? String(error) }
        );
      }
      if (!admissionOutcome || typeof admissionOutcome !== "object") {
        return postBootstrapRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "worker_admission_no_result",
          null
        );
      }
      const admissionSnapshotRefusal = await validateFrozenWorkerScope(
        "worker_admission",
        admissionOutcome
      );
      if (admissionSnapshotRefusal) return admissionSnapshotRefusal;
      if (!admissionOutcome.allowed) {

        const refusalDetail = admissionOutcome.remote_admission
          ? { ...(admissionOutcome.detail ?? {}), remote_admission: admissionOutcome.remote_admission }
          : (admissionOutcome.detail ?? null);
        return postBootstrapRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          admissionOutcome.reason ?? "worker_admission_refused",
          refusalDetail
        );
      }
      workerAdmissionDiagnostic = admissionOutcome.remote_admission ?? null;
    }

    const sourceAccessResult = await resolveWorkerSourceAccess({
      app,
      role,
      subject,
      workspace_dir,
      familyExecutorRegistryEntry,
      proveAssignedSourceReadable,

      scopeExistence: frozenWorkerScopeSnapshot?.scope_existence ?? null
    });
    if (!sourceAccessResult.ok) {
      return postBootstrapRefusal(
        sourceAccessResult.refusal.code,
        sourceAccessResult.refusal.reason,
        sourceAccessResult.refusal.detail
      );
    }
    const sourceSnapshotRefusal = await validateFrozenWorkerScope(
      "source_preparation",
      sourceAccessResult
    );
    if (sourceSnapshotRefusal) return sourceSnapshotRefusal;

    const reviewerLaunchIdentity = typeof deriveReviewerLaunchIdentity === "function"
      ? deriveReviewerLaunchIdentity({ role, subject, workspace_dir })
      : null;

    const executorReadiness = isPlainObject(readiness)
      ? { ...readiness }
      : readiness;
    if (isPlainObject(executorReadiness)) {
      delete executorReadiness.trusted_corrective_findings_context;
      delete executorReadiness.config_root_dir;
      delete executorReadiness.trusted_frozen_review_contract;
      if (findingsLifecycle) {
        executorReadiness.config_root_dir = config_root_dir;
        executorReadiness.trusted_frozen_review_contract = trusted_frozen_review_contract;
      }
    }

    const startedAtMs = clock();
    const startedAt = new Date(startedAtMs).toISOString();

    let reviewerValidationEvidence = null;
    if (role === "reviewer" && Array.isArray(executorReadiness?.reviewer_validation_evidence) &&
        executorReadiness.reviewer_validation_evidence.length > 0) {
      const target = executorReadiness.frozen_terminal_candidate_review_target ?? null;
      try {
        reviewerValidationEvidence = bindReviewerValidationEvidence(
          executorReadiness.reviewer_validation_evidence,
          {
            reviewerRunId: run_id,
            subject,
            reviewedSha: target?.candidate_sha ?? null,
            diffBaseSha: target?.base_sha ?? null
          }
        );
      } catch (error) {
        return postBootstrapRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "reviewer_validation_evidence_invalid",
          { code: error?.code ?? null }
        );
      }
      executorReadiness.reviewer_validation_evidence = reviewerValidationEvidence;
    }

    const executorSnapshotRefusal = await validateFrozenWorkerScope("executor_planning");
    if (executorSnapshotRefusal) return executorSnapshotRefusal;

    let pendingManagedRunIdentity = null;
    if (role === "worker" &&
        typeof publishPendingManagedRunIdentity === "function") {
      try {
        pendingManagedRunIdentity = await publishPendingManagedRunIdentity({
          role,
          subject,
          run_id,
          monitor_handle,

          reservation: reservationHolder.reservation
        });
      } catch (error) {
        return postBootstrapRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "managed_run_identity_publication_failed",
          { subject, code: error?.code ?? null, message: error?.message ?? String(error) }
        );
      }
      if (pendingManagedRunIdentity === null || pendingManagedRunIdentity === undefined) {
        return postBootstrapRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "managed_run_identity_publication_incomplete",
          { subject }
        );
      }
    }

    let executorResult;
    let sessionContract = null;
    try {

      const ensuredValidatorCache = await prepareCompiledValidatorCache({ mode: "ensure" });

      if (findingsLifecycle) {
        const verifiedValidatorCache = await prepareCompiledValidatorCache({ mode: "verify" });
        const validatorCacheBinds = standaloneValidatorCacheBinds({
          ensured: ensuredValidatorCache,
          verified: verifiedValidatorCache,
          workspaceDir: workspace_dir
        });
        const existingBinds = findingsLifecycleContext.reviewer_dependency_binds;
        const validatorDestinations = validatorCacheBinds.map(({ dst }) => dst);
        if (existingBinds.some(({ dst }) => validatorDestinations.some((candidate) =>
          dst === candidate || isContainedPath(dst, candidate) || isContainedPath(candidate, dst)))) {
          throw validatorCacheBackingError(
            "validator_cache_containment_violation",
            "compiled-validator cache destination overlaps another reviewer projection"
          );
        }
        appendLauncherFindingsExecutionBinds(
          findingsLifecycleContext,
          Object.freeze([...validatorCacheBinds])
        );
      }
    } catch (error) {
      return postBootstrapRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "compiled_validator_cache_preparation_failed",
        { code: error?.code ?? null }
      );
    }

    const refusePreExecutorSettlement = async (reason, detail = null) => {
      const cleanup = await discardPendingManagedRunIdentity({
        pending: pendingManagedRunIdentity,
        reservationHolder,
        releaseSubjectReservation,
        subject,
        reason
      });
      pendingManagedRunIdentity = null;
      return cleanup === null
        ? postBootstrapRefusal(
            BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
            reason,
            detail
          )
        : attachTransitionPlan(cleanup);
    };
    if (managedBootstrapComplete) {
      let authenticatedWkTip;
      try {
        authenticatedWkTip = authenticateManagedWkTip?.({ subject }) ?? null;
      } catch (error) {
        return refusePreExecutorSettlement(
          "managed_wk_tip_authentication_failed",
          { cause_code: typeof error?.code === "string" ? error.code : null }
        );
      }
      if (authenticatedWkTip === null) {
        return refusePreExecutorSettlement("managed_wk_tip_authentication_unavailable");
      }
      let projected;
      try {
        projected = projectLauncherTransitionOwnerSettlement(activeTransitionPlan, {
          subject,
          selection: transitionSelection,
          authenticated_wk_tip: authenticatedWkTip
        });
      } catch {
        return refusePreExecutorSettlement("managed_wk_tip_projection_invalid");
      }
      if (projected !== activeTransitionPlan) {
        activeTransitionPlan = projected;
        let freshBootstrap;
        try {
          freshBootstrap = await bootstrapManagedWkLifecycle({
            input: {
              ...input,
              launcher_transition_plan: activeTransitionPlan,
              settle_launcher_transition_plan: (facts) => {
                activeTransitionPlan = projectLauncherTransitionOwnerSettlement(
                  activeTransitionPlan,
                  {
                    subject,
                    selection: transitionSelection,
                    authenticated_wk_tip: authenticatedWkTip,
                    owner_settlement: facts.settlement
                  }
                );
                if (activeTransitionPlan.lifecycle.state !== "fresh_settlement_observed") {
                  return;
                }
                activeTransitionPlan = allocateLauncherTransitionPlan(activeTransitionPlan, {
                  subject,
                  selection: transitionSelection,
                  readiness,
                  findingsRouteAdmission: null,
                  plannedBase: facts.planned_base,
                  settlement: facts.settlement,
                  dependencyEvidence: facts.dependency_evidence,
                  publicationIdentities: facts.publication_identities,
                  reservationState: reservationHolder.reservation === null
                    ? "not_required"
                    : "held"
                });
                settledTransitionPlan = activeTransitionPlan;
              }
            },
            app,
            role,
            subject,
            run_id,
            monitor_handle
          });
        } catch (error) {
          return refusePreExecutorSettlement(
            "managed_wk_tip_resettlement_threw",
            { cause_code: typeof error?.code === "string" ? error.code : null }
          );
        }
        if (freshBootstrap?.ok !== true || activeTransitionPlan.phase !== "allocated" ||
            !revalidateLauncherTransitionPlan(activeTransitionPlan, {
              subject,
              selection: transitionSelection,
              phase: "allocated",
              authenticated_wk_tip: authenticatedWkTip
            })) {
          const refusal = freshBootstrap?.refusal ?? {};
          return refusePreExecutorSettlement(
            refusal.reason ?? "managed_wk_tip_resettlement_refused",
            refusal.detail ?? null
          );
        }
        managedWkLifecycleTicket = freshBootstrap.worker_provisioning_ticket ?? null;
        managedWkAllocation = freshBootstrap.readiness_allocation ?? managedWkAllocation;

        if (role === "worker") {
          const refreshed = await freezeWorkerScopeSnapshot({
            input: { ...input, launcher_transition_plan: activeTransitionPlan },
            app,
            role,
            subject,
            run_id,
            monitor_handle,
            managed_wk_lifecycle_ticket: managedWkLifecycleTicket,
            workspace_dir: workspace_dir ?? null
          });
          if (refreshed?.ok !== true) {
            return refusePreExecutorSettlement(
              refreshed?.refusal?.reason ?? "worker_scope_resettlement_failed",
              refreshed?.refusal?.detail ?? null
            );
          }
          frozenWorkerScopeSnapshot = refreshed.snapshot ?? null;
          const refreshedScopeRefusal = await validateFrozenWorkerScope(
            "pre_executor_wk_tip_resettlement"
          );
          if (refreshedScopeRefusal !== null) {
            return refusePreExecutorSettlement(
              refreshedScopeRefusal.refusal?.reason ?? "worker_scope_resettlement_invalid",
              refreshedScopeRefusal.refusal?.detail ?? null
            );
          }
          const refreshedSource = await resolveWorkerSourceAccess({
            app,
            role,
            subject,
            workspace_dir,
            familyExecutorRegistryEntry,
            proveAssignedSourceReadable,
            scopeExistence: frozenWorkerScopeSnapshot?.scope_existence ?? null
          });
          if (!refreshedSource.ok) {
            return refusePreExecutorSettlement(
              refreshedSource.refusal.reason,
              refreshedSource.refusal.detail
            );
          }
        }

        let finalAuthenticatedTip;
        try {
          finalAuthenticatedTip = authenticateManagedWkTip?.({ subject }) ?? null;
        } catch {
          finalAuthenticatedTip = null;
        }
        if (!revalidateLauncherTransitionPlan(activeTransitionPlan, {
          subject,
          selection: transitionSelection,
          phase: "allocated",
          authenticated_wk_tip: finalAuthenticatedTip
        })) {
          return refusePreExecutorSettlement("managed_wk_tip_moved_after_resettlement");
        }
      }
    }
    try {
      if (!findingsLifecycle && activeTransitionPlan.phase !== "allocated") {
        settleLauncherTransitionPlan({
          planned_base: null,
          settlement: null,
          dependency_evidence: null,
          publication_identities: []
        });
      }
      const captured = await captureLauncherAgentSessionContract(() => familyExecutor({
        caller_session_id,
        role,
        subject,
        workspace_alias: workspace_alias ?? null,
        workspace_dir: workspace_dir ?? null,
        readiness: executorReadiness ?? null,
        run_id,
        monitor_handle,
        app,

        model: resolvedModel,
        backend: resolvedBackend,
        backend_profile: resolvedBackendProfile,
        default_effort: resolvedDefaultEffort,
        routeKind,
        applicable,
        launcher_transition_plan: activeTransitionPlan,

        frozen_worker_scope_snapshot: frozenWorkerScopeSnapshot,

        canonical_unit_write_scope,
        launcher_findings_lifecycle_context: findingsLifecycleContext,
        config_root_dir: findingsLifecycle
          ? findingsLifecycleContext.canonical_metadata_root
          : null,
        trusted_frozen_review_contract: findingsLifecycle
          ? findingsLifecycleContext.trusted_frozen_review_contract
          : null,
        reviewer_dependency_binds: findingsLifecycle
          ? findingsLifecycleContext.reviewer_dependency_binds
          : null,

        completion_transport: completionTransport,
        completion_credential: completionCredential,
      }));
      executorResult = captured.result;
      sessionContract = captured.sessionContract;
    } catch (error) {
      if (findingsLifecycle) {
        executorResult = Object.freeze({
          accepted: true,
          status: "failed",
          exit: Object.freeze({
            code: null,
            signal: null,
            error_code: "advisory_review_executor_failed"
          }),
          final_result: Object.freeze({
            kind: "missing_result",
            result_mode: Object.freeze({ mode: "runtime_failure" })
          })
        });
        sessionContract = null;
      } else {
      const cleanupRefusal = await discardPendingManagedRunIdentity({
          pending: pendingManagedRunIdentity,
          reservationHolder,
          releaseSubjectReservation,
          subject,
          reason: "launch_executor_threw"
        });
      return attachTransitionPlan(cleanupRefusal ?? dispatchRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "launch_executor_threw",
        { message: error?.message ?? String(error) }
      ));
      }
    }

    const launchOutcome = await finalizeLaunchOutcome({
      executorResult,
      pendingManagedRunIdentity,
      reservationHolder,
      releaseSubjectReservation,
      bindManagedRunOuterIdentity,
      runs,
      captureSliceReviewTerminalResult,
      settleFormalReviewAttestation,
      run_id,
      monitor_handle,
      app,
      resolvedModel,
      resolvedBackend,
      role,
      subject,
      workspace_alias,
      caller_session_id,
      startedAt,
      reviewerValidationEvidence,
      reviewerLaunchIdentity,
      workerAdmissionDiagnostic,
      sessionContract,
      reviewerAttemptLineageOwner: null,
      findingsLifecycle
    });
    return attachTransitionPlan(launchOutcome);
  }

  return { startLaunch };
}
