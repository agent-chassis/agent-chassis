

import { computeWorkRecordSourceDigest } from "@agent-chassis/wiki-core";
import { createManagedWkAllocationReadiness } from
  "@agent-chassis/wiki-core/src/lib/work-record-dispatch-readiness-shape.mjs";
import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";
import path from "node:path";
import {
  WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER,
  WORKER_READ_BOUNDARY_UNSUPPORTED_BLOCKER,
  SUPPORTED_WORKER_READ_BOUNDARY_FAMILIES,
  SUPPORTED_WORKER_READ_BOUNDARY_BACKENDS,
  CALLER_SCOPE_CARRIERS,
  CALLER_MANAGED_LIFECYCLE_CARRIERS,
  CONFIG_ATTEMPT_STATE_CARRIERS
} from "./backend-constants.mjs";
import {
  isPlainObject,
  hasManagedConfinementActivation,
  createRetainedReviewerLaunchIdentity,
  createRetainedSliceReviewerLaunchIdentity
} from "./backend-review-identity.mjs";
import {
  scopeAuthorityRefusal,
  firstOwnField,
  deepFreezeCanonicalSnapshot,
  resolveFrozenWorkerScopeAuthority,
  assertProvisionedScopeAuthority,
  readCanonicalWorkRecord
} from "./backend-scope-authority.mjs";
import {
  managedRefusal,
  MANAGED_PROVISIONING_UNAVAILABLE,
  MANAGED_LIFECYCLE_REQUIRED,
  resolveProvisioningInitiative,
  resolveExactSliceDependencies,
  revalidateLauncherTransitionSettlement,
  provisioningRefusal
} from "./backend-provisioning-state.mjs";
import { resolveVerifiedSparseExactUnitBinding } from "./worktree-substrate.mjs";
import { allocateFullSliceExactUnitWorktree } from "./worktree-substrate-exact-unit.mjs";
import {
  assertCompleteManagedProvisioningResult,
  provisionManagedWorktreesAtDispatch
} from "./worktree-provisioning-dispatch.mjs";
import {
  authenticateManagedWkTipAtDispatch,
  provisionManagedWkLifecycleAtDispatch
} from
  "./worktree-provisioning-dispatch-managed.mjs";
import { LAUNCHER_TRANSITION_FAILURES } from "./launcher-transition-plan.mjs";
import {
  validateCorrectiveIntegrationChain
} from "./trusted-slice-integration.mjs";
import {
  readCanonicalContractGenerationIdentity
} from "./slice-integration-authorization.mjs";

export const CORRECTIVE_REMAINING_SCOPE_TRANSITION_SCHEMA_VERSION =
  "corrective-remaining-scope-transition.v1";

const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const canonical = (value) => JSON.stringify(value);
const sortedUnique = (values) => [...new Set(values)].sort();

export function correctionPopulationFromTargets(targets, correctionIds, repoPaths) {
  if (!Array.isArray(targets) || targets.length === 0 ||
      !Array.isArray(correctionIds) || correctionIds.length !== targets.length ||
      !Array.isArray(repoPaths)) {
    throw new Error("a corrective population requires paired contract-authored IDs and targets");
  }
  return Object.freeze(targets.map((target, index) => {
    if (!isPlainObject(target) || typeof target.path !== "string" || target.path.length === 0) {
      throw new Error("a corrective target must carry one bounded repository path");
    }
    if (!repoPaths.includes(target.path)) {
      throw new Error("a corrective target is outside the contract-authored repository paths");
    }
    return deepFreezeCanonicalSnapshot({
      correction_id: correctionIds[index],
      target_scope: [target],
      write_scope: [target.path],
      repo_paths: [target.path]
    });
  }));
}

function assertPopulation(population, label) {
  if (!Array.isArray(population)) throw new Error(`${label} must be an array`);
  const ids = new Set();
  for (const entry of population) {
    if (!isPlainObject(entry) || Object.keys(entry).sort().join("|") !==
          "correction_id|repo_paths|target_scope|write_scope" ||
        typeof entry.correction_id !== "string" || entry.correction_id.length === 0 ||
        entry.correction_id.length > 256 ||
        !Array.isArray(entry.target_scope) || entry.target_scope.length === 0 ||
        !Array.isArray(entry.write_scope) || entry.write_scope.length === 0 ||
        !Array.isArray(entry.repo_paths) || entry.repo_paths.length === 0 ||
        ids.has(entry.correction_id)) throw new Error(`${label} is malformed or duplicated`);
    const paths = entry.target_scope.map((target) => target?.path);
    if (paths.some((value) => typeof value !== "string" || value.length === 0) ||
        canonical(sortedUnique(entry.write_scope)) !== canonical(sortedUnique(paths)) ||
        canonical(sortedUnique(entry.repo_paths)) !== canonical(sortedUnique(paths))) {
      throw new Error(`${label} carries scope outside its bounded targets`);
    }
    ids.add(entry.correction_id);
  }
  return ids;
}

export function createCorrectiveRemainingScopeTransition({
  subject,
  controlledContractGeneration,
  predecessorWkTip,
  beforePopulation,
  deliveredIds,
  integrationHopDigest
}) {
  const beforeIds = assertPopulation(beforePopulation, "corrective before population");
  if (typeof subject !== "string" || !OID_RE.test(predecessorWkTip ?? "") ||
      typeof controlledContractGeneration !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(integrationHopDigest ?? "") ||
      !Array.isArray(deliveredIds) || deliveredIds.length === 0 ||
      new Set(deliveredIds).size !== deliveredIds.length ||
      deliveredIds.some((id) => !beforeIds.has(id))) {
    throw new Error("corrective remaining-scope transition inputs are not authenticated");
  }
  const delivered = new Set(deliveredIds);
  return deepFreezeCanonicalSnapshot({
    schema_version: CORRECTIVE_REMAINING_SCOPE_TRANSITION_SCHEMA_VERSION,
    subject,
    controlled_contract_generation: controlledContractGeneration,
    predecessor_wk_tip: predecessorWkTip,
    integration_hop_digest: integrationHopDigest,
    before: beforePopulation,
    delivered_ids: [...deliveredIds],
    after: beforePopulation.filter((entry) => !delivered.has(entry.correction_id))
  });
}

export function validateCorrectiveRemainingScopeTransition(transition, {
  subject,
  controlledContractGeneration,
  integrationChain
}) {
  validateCorrectiveIntegrationChain(integrationChain, {
    subject,
    controlledContractGeneration,
    currentWkTip: integrationChain?.hops?.at(-1)?.post_wk_tip ?? null
  });
  if (!isPlainObject(transition) || Object.keys(transition).sort().join("|") !==
        "after|before|controlled_contract_generation|delivered_ids|integration_hop_digest|predecessor_wk_tip|schema_version|subject" ||
      transition.schema_version !== CORRECTIVE_REMAINING_SCOPE_TRANSITION_SCHEMA_VERSION ||
      transition.subject !== subject ||
      transition.controlled_contract_generation !== controlledContractGeneration) {
    throw new Error("corrective remaining-scope transition identity is stale or mismatched");
  }
  const beforeIds = assertPopulation(transition.before, "corrective before population");
  const afterIds = assertPopulation(transition.after, "corrective after population");
  const delivered = transition.delivered_ids;
  if (!Array.isArray(delivered) || delivered.length === 0 ||
      new Set(delivered).size !== delivered.length || delivered.some((id) => !beforeIds.has(id))) {
    throw new Error("corrective delivered-ID population is invalid");
  }
  const expectedAfter = transition.before
    .filter((entry) => !new Set(delivered).has(entry.correction_id));
  if (canonical(expectedAfter) !== canonical(transition.after) ||
      [...afterIds].some((id) => !beforeIds.has(id))) {
    throw new Error("corrective before/delivered/after subtraction is inconsistent");
  }
  const terminal = integrationChain?.hops?.at(-1) ?? null;
  if (terminal?.hop_digest !== transition.integration_hop_digest ||
      terminal?.pre_wk_tip !== transition.predecessor_wk_tip ||
      terminal?.controlled_contract_generation !==
        transition.controlled_contract_generation) {
    throw new Error("corrective remaining scope is not bound to the authenticated integration chain");
  }
  return transition;
}

export function validateCurrentCorrectionSelection(slice, transition) {
  const ids = slice?.current_correction_ids;
  if (!Array.isArray(ids) || ids.length === 0 || new Set(ids).size !== ids.length) {
    throw new Error("current_correction_ids must be one nonempty canonical selection");
  }
  const remaining = new Map(transition.after.map((entry) => [entry.correction_id, entry]));
  if (ids.some((id) => !remaining.has(id))) {
    throw new Error("current_correction_ids reuses a delivered or unknown correction ID");
  }
  const selected = ids.map((id) => remaining.get(id));
  const expectedTargets = selected.flatMap((entry) => entry.target_scope);
  const expectedWrite = sortedUnique(selected.flatMap((entry) => entry.write_scope));
  const expectedRepoPaths = sortedUnique(selected.flatMap((entry) => entry.repo_paths));
  const sameTargets = canonical([...slice.expected_edit_targets].sort((a, b) =>
    canonical(a).localeCompare(canonical(b)))) === canonical([...expectedTargets].sort((a, b) =>
    canonical(a).localeCompare(canonical(b))));
  if (!sameTargets || canonical(sortedUnique(slice.write_scope ?? [])) !== canonical(expectedWrite) ||
      canonical(sortedUnique(slice.repo_paths ?? [])) !== canonical(expectedRepoPaths)) {
    throw new Error("canonical corrective scope is broader than the selected remaining-ID union");
  }
  return deepFreezeCanonicalSnapshot({ correction_ids: ids, target_scope: expectedTargets,
    write_scope: expectedWrite, repo_paths: expectedRepoPaths });
}

export function createIntegratedCorrectiveRemainingScopeTransition({
  mainRepo,
  subject,
  controlledContractGeneration,
  integrationChain,
  integrationHop,
  priorTransition = null
}) {
  const record = readCanonicalWorkRecord(mainRepo, subject);
  const sliceId = subject.split("#")[1] ?? null;
  const slice = record?.slices?.find((entry) => entry?.id === sliceId) ?? null;
  const deliveredIds = slice?.current_correction_ids;

  if (!Array.isArray(deliveredIds) || deliveredIds.length === 0) return priorTransition;
  let beforePopulation;
  if (priorTransition !== null) {
    validateCorrectiveRemainingScopeTransition(priorTransition, {
      subject,
      controlledContractGeneration,
      integrationChain: { ...integrationChain,
        hops: integrationChain.hops.slice(0, -1) }
    });
    beforePopulation = priorTransition.after;
  } else {
    assertPopulation(slice?.correction_population, "canonical corrective population");
    beforePopulation = deepFreezeCanonicalSnapshot(slice.correction_population);
  }
  validateCurrentCorrectionSelection({ ...slice, current_correction_ids: deliveredIds }, {
    after: beforePopulation
  });
  return createCorrectiveRemainingScopeTransition({
    subject,
    controlledContractGeneration,
    predecessorWkTip: integrationHop.pre_wk_tip,
    beforePopulation,
    deliveredIds,
    integrationHopDigest: integrationHop.hop_digest
  });
}

import { resolveDispatchSelection } from "./workspace-agent-dispatch-run-lifecycle-selection.mjs";

function canonicalScopeEntries(value, { writable = false, required = false } = {}) {
  if (!Array.isArray(value)) return !required && value === undefined ? [] : null;
  const entries = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry !== entry.trim() ||
        path.posix.isAbsolute(entry) || entry.startsWith("-") || entry.includes("\\") ||
        /[\x00-\x1f\x7f]/.test(entry) || path.posix.normalize(entry) !== entry ||
        entry === ".") {
      return null;
    }
    const segments = entry.split("/");
    if (segments.includes("") || segments.includes(".") || segments.includes("..")) {
      return null;
    }
    if (segments.includes(".git")) return null;
    const wildcardIndex = segments.findIndex((part) => /[*?[]/.test(part));
    if (wildcardIndex === 0 || (writable && wildcardIndex !== -1)) return null;
    entries.push(entry);
  }
  return [...new Set(entries)].sort();
}

function selectedCanonicalUnit(record, subject) {
  if (!isPlainObject(record) || typeof subject !== "string") return null;
  const separator = subject.indexOf("#");
  if (separator < 0) return record;
  const sliceId = subject.slice(separator + 1);
  return Array.isArray(record.slices)
    ? record.slices.find((candidate) => candidate?.id === sliceId) ?? null
    : null;
}

function selectionRefusal(selection) {
  return selection;
}

export function createBackendScope(ctx) {
  const {
    worktreeProvisioningConfig,
    requireManagedProvisioning,
    registeredWorkerScopeSnapshots,
    frozenSliceReviewContexts,
    frozenReviewContexts,
    managedWorktreeProvisioningAuthority,

    repositoryRoot = worktreeProvisioningConfig?.mainRepo ?? null
  } = ctx;
  const readCorrectiveCanonicalRecord =
    worktreeProvisioningConfig?.deps?.readCanonicalWorkRecord ??
    readCanonicalWorkRecord;
  const readCorrectiveCanonicalGeneration =
    worktreeProvisioningConfig?.deps?.readCanonicalContractGenerationIdentity ??
    readCanonicalContractGenerationIdentity;

  function workerScopeSnapshotRefusal(reason, detail = null) {
    return {
      ok: false,
      refusal: scopeAuthorityRefusal(WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER, {
        reason,
        ...detail
      }).refusal
    };
  }

  function bootstrapRefusal(result) {
    return Object.freeze({ ok: false, refusal: result?.refusal ?? result });
  }

  function transitionBootstrapRefusal(failure, detail) {
    return bootstrapRefusal(managedRefusal(failure.code, {
      ...detail,
      authority_limb: failure.authority_limb,
      next_action: failure.next_action
    }));
  }

  async function bootstrapManagedWkLifecycle({
    input = {}, app, role, subject, run_id: runId, monitor_handle: monitorHandle
  } = {}) {
    if (worktreeProvisioningConfig === null) {
      return requireManagedProvisioning === true
        ? bootstrapRefusal(managedRefusal(MANAGED_PROVISIONING_UNAVAILABLE, {
            capability: "managed_wk_lifecycle_bootstrap"
          }))
        : Object.freeze({ ok: true, worker_provisioning_ticket: null, wk_lifecycle: null });
    }
    const callerCarrier = firstOwnField(input, CALLER_SCOPE_CARRIERS);
    const lifecycleCarrier = firstOwnField(input, CALLER_MANAGED_LIFECYCLE_CARRIERS);
    const configCarrier = firstOwnField(worktreeProvisioningConfig, CALLER_SCOPE_CARRIERS);
    const configAttemptCarrier = firstOwnField(
      worktreeProvisioningConfig, CONFIG_ATTEMPT_STATE_CARRIERS
    );
    if (callerCarrier !== null || lifecycleCarrier !== null ||
        configCarrier !== null || configAttemptCarrier !== null) {
      return bootstrapRefusal(scopeAuthorityRefusal(WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER, {
        reason: lifecycleCarrier !== null || configAttemptCarrier !== null
          ? "caller_carried_managed_lifecycle_forbidden"
          : "caller_carried_scope_forbidden",
        field: callerCarrier ?? lifecycleCarrier ?? configCarrier ?? configAttemptCarrier,
        carrier: callerCarrier !== null || lifecycleCarrier !== null
          ? "dispatch_input"
          : "provisioning_config"
      }));
    }
    const initiative = resolveProvisioningInitiative({
      readiness: input.readiness ?? null,
      mainRepo: worktreeProvisioningConfig.mainRepo,
      subject
    });
    if (initiative === null) {
      return bootstrapRefusal({
        refusal: {
          code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          reason: "worktree_provisioning_initiative_unresolved",
          detail: { subject }
        }
      });
    }

    let retryId = 0;
    if (role === "worker") {
      if (!SUPPORTED_WORKER_READ_BOUNDARY_FAMILIES.includes(app)) {
        return bootstrapRefusal(scopeAuthorityRefusal(WORKER_READ_BOUNDARY_UNSUPPORTED_BLOCKER, {
          reason: "unsupported_family",
          family: app,
          supported_families: SUPPORTED_WORKER_READ_BOUNDARY_FAMILIES
        }));
      }
      const boundaryBackend = worktreeProvisioningConfig.readBoundaryBackend
        ?? worktreeProvisioningConfig.read_boundary_backend
        ?? worktreeProvisioningConfig.isolationBackend
        ?? worktreeProvisioningConfig.isolation_backend
        ?? "bwrap";
      if (!SUPPORTED_WORKER_READ_BOUNDARY_BACKENDS.includes(boundaryBackend)) {
        return bootstrapRefusal(scopeAuthorityRefusal(WORKER_READ_BOUNDARY_UNSUPPORTED_BLOCKER, {
          reason: "unsupported_backend",
          backend: boundaryBackend,
          supported_backends: SUPPORTED_WORKER_READ_BOUNDARY_BACKENDS
        }));
      }
      if (!hasManagedConfinementActivation(worktreeProvisioningConfig)) {
        return bootstrapRefusal(managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
          capability: "repository_read_boundary",
          dependency: "WK-1455",
          message: "managed worker spawn remains disabled until exact confinement is available"
        }));
      }
      const attempt = await managedWorktreeProvisioningAuthority.resolveAttemptState({
        input: { ...input, role, subject, run_id: runId, monitor_handle: monitorHandle },
        initiative
      });
      if (!attempt.ok) return bootstrapRefusal(attempt.refusal);
      retryId = attempt.state.retryId;
      const confirmPriorWorkerTerminated =
        attempt.state.livenessDeps?.confirmPriorWorkerTerminated ?? null;
      if (confirmPriorWorkerTerminated !== null && await confirmPriorWorkerTerminated({
        launchRef: monitorHandle,
        runId,
        retryId,
        priorIdentity: attempt.state.priorIdentity,
        unitAddress: `${initiative}/${subject.replace("#", "/")}`
      }) !== true) {
        return bootstrapRefusal({
          refusal: {
            code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
            reason: "worktree_provisioning_prior_worker_liveness_unconfirmed",
            detail: { retry_id: retryId }
          }
        });
      }
    }

    try {
      if (role !== "worker") {
        const wkLifecycle = await provisionManagedWkLifecycleAtDispatch({
          mainRepo: worktreeProvisioningConfig.mainRepo,
          initiative,
          subject,
          launchRef: monitorHandle,
          runId,
          retryId,
          worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
          deps: worktreeProvisioningConfig.deps ?? {}
        });
        const plannedBase = Object.freeze({
          base_ref: wkLifecycle.wk_binding.output_branch,
          base_sha: wkLifecycle.wk_snapshot.tip
        });
        if (typeof input.settle_launcher_transition_plan === "function") {
          input.settle_launcher_transition_plan({
            settlement: wkLifecycle,
            planned_base: plannedBase,
            dependency_evidence: Object.freeze([]),
            publication_identities: Object.freeze([])
          });
        }
        const readinessAllocation = createManagedWkAllocationReadiness({
          allocation: wkLifecycle,
          repository: input.workspace_alias ?? null,
          role,
          subject,
          runId,
          monitorHandle
        });
        return Object.freeze({
          ok: true,
          worker_provisioning_ticket: null,
          wk_lifecycle: wkLifecycle,
          readiness_allocation: readinessAllocation
        });
      }

      const configuredAllocateSlice =
        worktreeProvisioningConfig.deps?.allocateFullSliceExactUnitWorktree
        ?? allocateFullSliceExactUnitWorktree;
      let wkLifecycle = null;
      const provisioning = await provisionManagedWorktreesAtDispatch({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        initiative,
        subject,
        launchRef: monitorHandle,
        runId,
        retryId,
        worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
        observeManagedWkLifecycle: (result) => {
          if (wkLifecycle !== null) {
            throw new Error("managed WK lifecycle result was observed more than once");
          }
          wkLifecycle = result;
        },
        deps: {
          ...(worktreeProvisioningConfig.deps ?? {}),
          allocateFullSliceExactUnitWorktree: (args) => configuredAllocateSlice({
            ...args,
            deps: {
              ...(args.deps ?? {}),
              verifyBinding: args.deps?.verifyBinding ?? resolveVerifiedSparseExactUnitBinding
            }
          })
        }
      });
      if (wkLifecycle === null) {
        throw new Error("managed WK lifecycle result was not observed before slice authority");
      }
      const plannedBase = Object.freeze({
        base_ref: provisioning.slice_binding.base_ref,
        base_sha: provisioning.slice_binding.base_sha
      });
      const settlementValidation = revalidateLauncherTransitionSettlement({
        settlement: provisioning, plannedBase
      });
      if (!settlementValidation.ok) {
        return transitionBootstrapRefusal(
          LAUNCHER_TRANSITION_FAILURES.LIFECYCLE_ALLOCATION_FAILED,
          { reason: settlementValidation.reason, planned_base: plannedBase }
        );
      }
      const dependencyResolution = resolveExactSliceDependencies(
        worktreeProvisioningConfig.mainRepo,
        subject,
        worktreeProvisioningConfig.deps ?? {},
        { settlement: provisioning, plannedBase }
      );
      const dependencies = typeof dependencyResolution?.then === "function"
        ? await dependencyResolution
        : dependencyResolution;
      if (!dependencies.ok) {
        const failure = dependencies.reason?.includes("publication_identity")
          ? LAUNCHER_TRANSITION_FAILURES.PUBLICATION_IDENTITY_UNRESOLVED
          : LAUNCHER_TRANSITION_FAILURES.DEPENDENCY_IDENTITY_UNRESOLVED;
        return transitionBootstrapRefusal(failure, dependencies);
      }
      assertCompleteManagedProvisioningResult({
        provisioning,
        mainRepo: worktreeProvisioningConfig.mainRepo,
        initiative,
        subject,
        launchRef: monitorHandle,
        runId,
        retryId,
        worktreeRoot: worktreeProvisioningConfig.worktreeRoot
      });
      if (typeof input.settle_launcher_transition_plan === "function") {
        input.settle_launcher_transition_plan({
          settlement: provisioning,
          planned_base: plannedBase,
          dependency_evidence: dependencies.dependency_evidence,
          publication_identities: dependencies.publication_identities ?? []
        });
      }
      const admitted = managedWorktreeProvisioningAuthority.admitEstablished({
        input: { ...input, role, subject, run_id: runId, monitor_handle: monitorHandle },
        app,
        state: Object.freeze({
          app,
          subject,
          run_id: runId,
          monitor_handle: monitorHandle,
          initiative,
          retry_id: retryId,
          dependencies,
          provisioning
        })
      });
      if (admitted?.ok !== true) return admitted;
      const readinessAllocation = createManagedWkAllocationReadiness({
        allocation: wkLifecycle,
        repository: input.workspace_alias ?? null,
        role,
        subject,
        runId,
        monitorHandle
      });
      return Object.freeze({
        ok: true,
        worker_provisioning_ticket: admitted.ticket,
        wk_lifecycle: wkLifecycle,
        readiness_allocation: readinessAllocation
      });
    } catch (error) {
      return bootstrapRefusal(provisioningRefusal(error));
    }
  }

  function authenticateManagedWkTip({ subject } = {}) {
    if (worktreeProvisioningConfig === null) return null;
    const initiative = resolveProvisioningInitiative({
      readiness: null,
      mainRepo: worktreeProvisioningConfig.mainRepo,
      subject
    });
    if (initiative === null) return null;
    return authenticateManagedWkTipAtDispatch({
      mainRepo: worktreeProvisioningConfig.mainRepo,
      initiative,
      subject,
      worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
      deps: worktreeProvisioningConfig.deps ?? {}
    });
  }

  function preflightCorrectiveScope({
    subject,
    correctiveIntegrationChain,
    correctiveRemainingScopeTransition
  }) {
    const record = readCorrectiveCanonicalRecord(worktreeProvisioningConfig.mainRepo, subject);
    const sliceId = subject.split("#")[1] ?? null;
    const slice = record?.slices?.find((candidate) => candidate?.id === sliceId) ?? null;
    const declaresSelection = isPlainObject(slice) &&
      Object.prototype.hasOwnProperty.call(slice, "current_correction_ids");
    const carriesChain = correctiveIntegrationChain !== null;
    const carriesTransition = correctiveRemainingScopeTransition !== null;
    if (!declaresSelection && !carriesChain && !carriesTransition) return null;
    if (!declaresSelection || carriesChain !== carriesTransition) {
      throw new Error("canonical corrective scope is missing its authenticated owner carriers");
    }
    const recordId = subject.split("#", 1)[0];
    const generation = readCorrectiveCanonicalGeneration(
      worktreeProvisioningConfig.mainRepo,
      recordId
    );
    if (typeof generation?.digest !== "string") {
      throw new Error("current controlled-contract generation is unavailable");
    }
    let transition = correctiveRemainingScopeTransition;
    if (!carriesChain) {
      assertPopulation(slice.correction_population, "canonical corrective population");
      transition = { after: slice.correction_population };
    } else {
      validateCorrectiveRemainingScopeTransition(correctiveRemainingScopeTransition, {
        subject,
        controlledContractGeneration: generation.digest,
        integrationChain: correctiveIntegrationChain
      });
    }
    return deepFreezeCanonicalSnapshot({
      record_digest: computeWorkRecordSourceDigest(record),
      controlled_contract_generation: generation.digest,
      scope: validateCurrentCorrectionSelection(slice, transition)
    });
  }

  async function freezeWorkerScopeSnapshot({
    input,
    app,
    role,
    subject,
    run_id: runId,
    monitor_handle: monitorHandle,
    managed_wk_lifecycle_ticket: managedWkLifecycleTicket = null,
    corrective_integration_chain: correctiveIntegrationChain = null,
    corrective_remaining_scope_transition: correctiveRemainingScopeTransition = null
  }) {
    if (role !== "worker" || (worktreeProvisioningConfig === null && requireManagedProvisioning !== true)) {
      return { ok: true, snapshot: null };
    }
    const callerCarrier = firstOwnField(input, CALLER_SCOPE_CARRIERS);
    const lifecycleCarrier = firstOwnField(input, CALLER_MANAGED_LIFECYCLE_CARRIERS);
    if (callerCarrier !== null || lifecycleCarrier !== null) {
      return workerScopeSnapshotRefusal(
        lifecycleCarrier !== null
          ? "caller_carried_managed_lifecycle_forbidden"
          : "caller_carried_scope_forbidden",
        {
          field: callerCarrier ?? lifecycleCarrier,
          carrier: "dispatch_input"
        }
      );
    }
    if (worktreeProvisioningConfig === null) {
      return {
        ok: false,
        refusal: managedRefusal(MANAGED_PROVISIONING_UNAVAILABLE, {
          capability: "managed_worktree_provisioning"
        }).refusal
      };
    }
    let correctivePreflight;
    try {
      correctivePreflight = preflightCorrectiveScope({
        subject,
        correctiveIntegrationChain,
        correctiveRemainingScopeTransition
      });
    } catch (error) {
      return workerScopeSnapshotRefusal("corrective_scope_preflight_failed", {
        message: error?.message ?? String(error)
      });
    }
    const managedProvisioningTicket = managedWkLifecycleTicket;
    const preparedState = managedWorktreeProvisioningAuthority.resolve({
      ticket: managedProvisioningTicket,
      input: {
        ...input,
        role,
        subject,
        run_id: runId,
        monitor_handle: monitorHandle
      },
      app
    });
    if (preparedState === null || preparedState.subject !== subject || preparedState.app !== app) {
      return workerScopeSnapshotRefusal("launcher_private_provisioning_unavailable", null);
    }
    const { dependencies, provisioning } = preparedState;
    if (!dependencies?.ok) {
      return { ok: false, refusal: managedRefusal(MANAGED_LIFECYCLE_REQUIRED, dependencies).refusal };
    }
    try {
      const record = deepFreezeCanonicalSnapshot(dependencies.record);
      const selectedUnitContract = record.slices.find(
        (candidate) => candidate?.id === dependencies.slice.id
      );
      if (correctivePreflight !== null &&
          computeWorkRecordSourceDigest(record) !== correctivePreflight.record_digest) {
        throw new Error("canonical corrective scope changed after preflight");
      }

      const scopeExistenceBase = Object.freeze({
        base_ref: provisioning.slice_binding.base_ref,
        base_sha: provisioning.slice_binding.base_sha
      });
      const authority = resolveFrozenWorkerScopeAuthority({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        subject,
        record,
        slice: selectedUnitContract,
        scopeBase: scopeExistenceBase,
        deps: worktreeProvisioningConfig.deps ?? {}
      });
      assertProvisionedScopeAuthority(provisioning.slice_binding, authority);
      if (provisioning.unit_address !== authority.unit_address ||
          provisioning.record_id !== authority.selected_unit.record_id ||
          provisioning.slice_id !== authority.selected_unit.slice_id) {
        throw new Error("managed provisioning identity does not match the frozen exact selected unit");
      }
      const snapshot = Object.freeze({
        authority,
        record,
        selected_unit_contract: selectedUnitContract,

        managed_provisioning_ticket: managedProvisioningTicket,
        corrective_integration_chain: correctiveIntegrationChain,
        corrective_remaining_scope_transition: correctiveRemainingScopeTransition,
        corrective_controlled_contract_generation:
          correctivePreflight?.controlled_contract_generation ?? null,
        corrective_scope: correctivePreflight?.scope ?? null,

        scope_existence: Object.freeze({
          main_repo: worktreeProvisioningConfig.mainRepo,
          base: scopeExistenceBase,
          run_git: worktreeProvisioningConfig.deps?.runGit ?? null
        })
      });
      registeredWorkerScopeSnapshots.add(snapshot);
      return { ok: true, snapshot };
    } catch (error) {
      return workerScopeSnapshotRefusal("canonical_scope_resolution_failed", {
        message: error?.message ?? String(error)
      });
    }
  }

  function validateWorkerScopeSnapshot({ snapshot, consumer, result = null }) {
    if (!isPlainObject(snapshot) || !registeredWorkerScopeSnapshots.has(snapshot) ||
        !Object.isFrozen(snapshot) || !Object.isFrozen(snapshot.record) ||
        !Object.isFrozen(snapshot.selected_unit_contract)) {
      return workerScopeSnapshotRefusal("frozen_scope_snapshot_unavailable", { consumer });
    }
    const expected = snapshot.authority;
    if ((snapshot.corrective_integration_chain === null) !==
        (snapshot.corrective_remaining_scope_transition === null)) {
      return workerScopeSnapshotRefusal("corrective_scope_carrier_incomplete", { consumer });
    }
    if (snapshot.corrective_scope !== null) {
      try {
        const currentGeneration = readCorrectiveCanonicalGeneration(
          worktreeProvisioningConfig.mainRepo,
          expected.selected_unit.record_id
        );
        if (currentGeneration?.digest !== snapshot.corrective_controlled_contract_generation) {
          throw new Error("current controlled-contract generation changed after scope freeze");
        }
        if (snapshot.corrective_integration_chain !== null) {
          validateCorrectiveRemainingScopeTransition(
            snapshot.corrective_remaining_scope_transition,
            { subject: expected.selected_unit.address,
              controlledContractGeneration: currentGeneration.digest,
              integrationChain: snapshot.corrective_integration_chain }
          );
        }
      } catch (error) {
        return workerScopeSnapshotRefusal("corrective_scope_transition_invalid", {
          consumer, message: error?.message ?? String(error)
        });
      }
    }
    const current = readCanonicalWorkRecord(worktreeProvisioningConfig.mainRepo, expected.selected_unit.address);
    const currentDigest = current === null ? null : computeWorkRecordSourceDigest(current);
    if (currentDigest !== expected.source_digest) {
      return workerScopeSnapshotRefusal("canonical_source_digest_changed", {
        consumer,
        expected_source_digest: expected.source_digest,
        actual_source_digest: currentDigest
      });
    }

    const bindings = [
      result,
      result?.binding,
      result?.worker_scope_authority
    ].filter(isPlainObject);
    for (const binding of bindings) {
      const digest = binding.source_record_digest ?? binding.source_digest;
      if (digest !== undefined && digest !== expected.source_digest) {
        return workerScopeSnapshotRefusal("downstream_source_digest_mismatch", {
          consumer,
          expected_source_digest: expected.source_digest,
          actual_source_digest: digest ?? null
        });
      }
      if (binding.selected_unit !== undefined &&
          (!isPlainObject(binding.selected_unit) ||
            ["kind", "address", "record_id", "slice_id", "repo"].some(
              (field) => binding.selected_unit[field] !== expected.selected_unit[field]
            ))) {
        return workerScopeSnapshotRefusal("downstream_selected_unit_mismatch", { consumer });
      }
    }
    return { ok: true };
  }

  function predictRepositoryScope({
    role,
    subject,
    target = null,
    target_role: targetRole = null,
    app = null,
    model = null,
    workspace_dir: workspaceDir = repositoryRoot,
    config_root_dir: configRootDir = null
  } = {}) {
    const selection = resolveDispatchSelection({
      role,
      app,
      model,
      target: target ?? subject,
      target_role: targetRole,
      subject,
      workspaceDir,
      configRootDir
    });
    if (!selection.ok) return selectionRefusal(selection);

    let canonicalRecord = null;
    if (repositoryRoot !== null) {
      const recordId = typeof subject === "string" ? subject.split("#", 1)[0] : null;
      canonicalRecord = recordId === null
        ? null
        : readCanonicalWorkRecord(repositoryRoot, recordId);
    }
    const canonicalUnit = selectedCanonicalUnit(canonicalRecord, subject);
    if (role === "reviewer" || role === "redteam") {
      const writeScope = isPlainObject(canonicalUnit)
        ? canonicalScopeEntries(canonicalUnit.write_scope, { writable: true, required: true })
        : [];
      if (writeScope === null) {
        return workerScopeSnapshotRefusal("canonical_scope_resolution_failed", { subject });
      }
      if (writeScope.length > 0) {
        return workerScopeSnapshotRefusal("findings_unit_write_scope_not_empty", {
          subject,
          write_scope: writeScope
        });
      }
      return {
        ok: true,
        selection,
        entitlement: Object.freeze({
          read_scope: Object.freeze(repositoryRoot === null ? [] : [repositoryRoot]),
          write_scope: Object.freeze([]),
          repository_root: repositoryRoot,
          read_only: true
        })
      };
    }
    if (role !== "worker" || !isPlainObject(canonicalUnit)) {
      return workerScopeSnapshotRefusal("canonical_scope_resolution_failed", { subject });
    }

    const readScope = canonicalScopeEntries(canonicalUnit.read_scope);
    const repoPaths = canonicalScopeEntries(canonicalUnit.repo_paths);
    const writeScope = canonicalScopeEntries(canonicalUnit.write_scope, { writable: true, required: true });
    if (readScope === null || repoPaths === null || writeScope === null) {
      return workerScopeSnapshotRefusal("canonical_scope_resolution_failed", { subject });
    }
    return {
      ok: true,
      selection,
      entitlement: Object.freeze({
        read_scope: Object.freeze([...new Set([...readScope, ...repoPaths, ...writeScope])].sort()),
        write_scope: Object.freeze(writeScope),
        repository_root: repositoryRoot,
        read_only: false
      })
    };
  }

  function deriveReviewerLaunchIdentity({ role, subject, workspace_dir: workspaceDir }) {
    if (role !== "reviewer" && role !== "redteam") return null;

    const sliceContext = frozenSliceReviewContexts.get(subject) ?? null;
    if (sliceContext !== null) {
      if (workspaceDir !== sliceContext.worktree_path) {
        throw new Error("backend-owned frozen slice reviewer launch identity does not match this exact slice worktree");
      }
      return createRetainedSliceReviewerLaunchIdentity(sliceContext);
    }
    const context = frozenReviewContexts.get(subject) ?? null;
    if (context === null) return null;
    if (workspaceDir !== context.worktree_path) {
      throw new Error("backend-owned frozen reviewer launch identity does not match this exact worktree");
    }
    return createRetainedReviewerLaunchIdentity(context);
  }

  Object.defineProperty(freezeWorkerScopeSnapshot, "bootstrapManagedWkLifecycle", {
    value: bootstrapManagedWkLifecycle,
    enumerable: false,
    configurable: false,
    writable: false
  });
  Object.defineProperty(freezeWorkerScopeSnapshot, "authenticateManagedWkTip", {
    value: authenticateManagedWkTip,
    enumerable: false,
    configurable: false,
    writable: false
  });

  return {
    workerScopeSnapshotRefusal,
    freezeWorkerScopeSnapshot,
    validateWorkerScopeSnapshot,
    deriveReviewerLaunchIdentity,
    predictRepositoryScope
  };
}
