

import path from "node:path";
import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";
import { resolveVerifiedSparseExactUnitBinding } from "./worktree-substrate.mjs";

import { allocateFullSliceExactUnitWorktree } from "./worktree-substrate-exact-unit.mjs";
import {
  assertCompleteManagedProvisioningResult,
  provisionManagedWorktreesAtDispatch
} from "./worktree-provisioning-dispatch.mjs";
import {
  CALLER_SCOPE_CARRIERS,
  CALLER_MANAGED_LIFECYCLE_CARRIERS,
  CONFIG_ATTEMPT_STATE_CARRIERS,
  WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER,
  WORKER_READ_BOUNDARY_UNSUPPORTED_BLOCKER,
  SUPPORTED_WORKER_READ_BOUNDARY_FAMILIES,
  SUPPORTED_WORKER_READ_BOUNDARY_BACKENDS
} from "./backend-constants.mjs";
import { isPlainObject, hasManagedConfinementActivation } from "./backend-review-identity.mjs";
import {
  firstOwnField,
  scopeAuthorityRefusal,
  assertProvisionedScopeAuthority
} from "./backend-scope-authority.mjs";
import {
  managedRefusal,
  MANAGED_PROVISIONING_UNAVAILABLE,
  MANAGED_LIFECYCLE_REQUIRED,
  resolveProvisioningInitiative,
  resolveProvisioningAttemptState,
  provisioningRefusal
} from "./backend-provisioning-state.mjs";

function firstStringField(source, names) {
  for (const name of names) {
    const value = source?.[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function deriveProvisionedWorktreeGitBinding(provisioning) {
  if (!isPlainObject(provisioning)) return null;
  const direct = provisioning.provisionedWorktreeGitBinding
    ?? provisioning.provisioned_worktree_git_binding
    ?? provisioning.provisionedWorktreeGitIdentity
    ?? provisioning.provisioned_worktree_git_identity
    ?? provisioning.git_binding
    ?? provisioning.git_identity
    ?? null;
  if (isPlainObject(direct)) {
    return Object.freeze({ ...direct });
  }

  const worktreePath = firstStringField(provisioning, ["worktree_path", "worktreePath"]);
  const gitDir = firstStringField(provisioning, [
    "git_dir",
    "gitDir",
    "worktree_git_dir",
    "worktreeGitDir"
  ]);
  const mainGitDir = firstStringField(provisioning, [
    "main_git_dir",
    "mainGitDir",
    "shared_git_dir",
    "sharedGitDir"
  ]);
  if (worktreePath === null || gitDir === null || mainGitDir === null) {
    return null;
  }

  const gitPointerFile = firstStringField(provisioning, [
    "git_pointer_file",
    "gitPointerFile",
    "worktree_git_pointer_file",
    "worktreeGitPointerFile"
  ]) ?? path.join(worktreePath, ".git");

  return Object.freeze({
    worktreePath,
    gitDir,
    mainGitDir,
    gitPointerFile
  });
}

export function maybeWrapExecutorWithWorktreeProvisioning(
  executor,
  app,
  provisioningConfig,
  requireManagedProvisioning,
  attemptStateAuthority,
  validateWorkerScopeSnapshot
) {
  if (typeof executor !== "function") return executor;
  if (provisioningConfig === null && requireManagedProvisioning !== true) return executor;
  return async function provisionedWorkspaceAgentExecutor(input = {}) {
    if (input.role !== "worker") {
      return executor(input);
    }

    if (provisioningConfig === null) {
      return managedRefusal(MANAGED_PROVISIONING_UNAVAILABLE, { capability: "managed_worktree_provisioning" });
    }
    const callerCarrier = firstOwnField(input, CALLER_SCOPE_CARRIERS);
    const lifecycleCarrier = firstOwnField(input, CALLER_MANAGED_LIFECYCLE_CARRIERS);
    const configCarrier = firstOwnField(provisioningConfig, CALLER_SCOPE_CARRIERS);
    const configAttemptCarrier = firstOwnField(provisioningConfig, CONFIG_ATTEMPT_STATE_CARRIERS);
    if (callerCarrier !== null || lifecycleCarrier !== null || configCarrier !== null || configAttemptCarrier !== null) {
      return scopeAuthorityRefusal(WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER, {
        reason: lifecycleCarrier !== null || configAttemptCarrier !== null
          ? "caller_carried_managed_lifecycle_forbidden"
          : "caller_carried_scope_forbidden",
        field: callerCarrier ?? lifecycleCarrier ?? configCarrier ?? configAttemptCarrier,
        carrier: callerCarrier !== null || lifecycleCarrier !== null ? "dispatch_input" : "provisioning_config"
      });
    }
    if (!SUPPORTED_WORKER_READ_BOUNDARY_FAMILIES.includes(app)) {
      return scopeAuthorityRefusal(WORKER_READ_BOUNDARY_UNSUPPORTED_BLOCKER, {
        reason: "unsupported_family",
        family: app,
        supported_families: SUPPORTED_WORKER_READ_BOUNDARY_FAMILIES
      });
    }
    const boundaryBackend = provisioningConfig.readBoundaryBackend
      ?? provisioningConfig.read_boundary_backend
      ?? provisioningConfig.isolationBackend
      ?? provisioningConfig.isolation_backend
      ?? "bwrap";
    if (!SUPPORTED_WORKER_READ_BOUNDARY_BACKENDS.includes(boundaryBackend)) {
      return scopeAuthorityRefusal(WORKER_READ_BOUNDARY_UNSUPPORTED_BLOCKER, {
        reason: "unsupported_backend",
        backend: boundaryBackend,
        supported_backends: SUPPORTED_WORKER_READ_BOUNDARY_BACKENDS
      });
    }
    const frozenScopeSnapshot = input.frozen_worker_scope_snapshot ?? null;
    const snapshotValidation = typeof validateWorkerScopeSnapshot === "function"
      ? await validateWorkerScopeSnapshot({
          snapshot: frozenScopeSnapshot,
          consumer: "provisioning",
          result: null
        })
      : null;
    if (!snapshotValidation?.ok) {
      return {
        accepted: false,
        refusal: snapshotValidation?.refusal ?? scopeAuthorityRefusal(
          WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER,
          { reason: "frozen_scope_snapshot_unavailable" }
        ).refusal
      };
    }
    const frozenScopeAuthority = frozenScopeSnapshot.authority;
    if (!hasManagedConfinementActivation(provisioningConfig)) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "repository_read_boundary",
        dependency: "WK-1455",
        message: "managed worker spawn remains disabled until the exact confinement/provisioning capability binding is available"
      });
    }

    let provisioning;
    let initiative;
    let provisioningRetryId;

    try {
      initiative = resolveProvisioningInitiative({
        readiness: input.readiness ?? null,
        mainRepo: provisioningConfig.mainRepo,
        subject: input.subject
      });
      if (initiative === null) {
        return {
          accepted: false,
          refusal: {
            code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
            reason: "worktree_provisioning_initiative_unresolved",
            detail: { subject: input.subject ?? null }
          }
        };
      }
      const attempt = await resolveProvisioningAttemptState({
        attemptStateAuthority,
        input,
        initiative
      });
      if (!attempt.ok) {
        return attempt.refusal;
      }
      provisioningRetryId = attempt.state.retryId;
      const confirmPriorWorkerTerminated =
        attempt.state.livenessDeps?.confirmPriorWorkerTerminated ?? null;
      if (confirmPriorWorkerTerminated !== null) {
        const priorIdentity = attempt.state.priorIdentity;
        const confirmed = await confirmPriorWorkerTerminated({
          launchRef: input.monitor_handle,
          runId: input.run_id,
          retryId: provisioningRetryId,
          priorIdentity,
          unitAddress: `${initiative}/${input.subject.replace("#", "/")}`
        });
        if (confirmed !== true) {
          return {
            accepted: false,
            refusal: {
              code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
              reason: "worktree_provisioning_prior_worker_liveness_unconfirmed",
              detail: { retry_id: provisioningRetryId }
            }
          };
        }
      }

      const configuredAllocateSlice = provisioningConfig.deps?.allocateFullSliceExactUnitWorktree
        ?? allocateFullSliceExactUnitWorktree;
      provisioning = provisionManagedWorktreesAtDispatch({
        mainRepo: provisioningConfig.mainRepo,
        initiative,
        subject: input.subject,
        launchRef: input.monitor_handle,
        runId: input.run_id,
        retryId: provisioningRetryId,
        worktreeRoot: provisioningConfig.worktreeRoot,
        deps: {
          ...(provisioningConfig.deps ?? {}),
          allocateFullSliceExactUnitWorktree: (args) => {
            const configuredVerifyBinding = args.deps?.verifyBinding
              ?? resolveVerifiedSparseExactUnitBinding;
            const binding = configuredAllocateSlice({
              ...args,
              deps: {
                ...(args.deps ?? {}),
                verifyBinding: (verifyArgs) => {
                  const verified = configuredVerifyBinding(verifyArgs);
                  assertProvisionedScopeAuthority(verified, frozenScopeAuthority);
                  return verified;
                }
              }
            });
            assertProvisionedScopeAuthority(binding, frozenScopeAuthority);
            return binding;
          }
        }
      });
    } catch (error) {
      return provisioningRefusal(error);
    }

    try {

      assertCompleteManagedProvisioningResult({
        provisioning,
        mainRepo: provisioningConfig.mainRepo,
        initiative,
        subject: input.subject,
        launchRef: input.monitor_handle,
        runId: input.run_id,
        retryId: provisioningRetryId,
        worktreeRoot: provisioningConfig.worktreeRoot
      });
    } catch (error) {
      return provisioningRefusal(error);
    }
    try {

      assertProvisionedScopeAuthority(provisioning.slice_binding, frozenScopeAuthority);
      if (provisioning.unit_address !== frozenScopeAuthority.unit_address ||
          provisioning.record_id !== frozenScopeAuthority.selected_unit.record_id ||
          provisioning.slice_id !== frozenScopeAuthority.selected_unit.slice_id) {
        throw new Error("managed provisioning identity does not match the frozen exact selected unit");
      }
    } catch (error) {
      return scopeAuthorityRefusal(WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER, {
        reason: "provisioning_authority_mismatch",
        message: error?.message ?? String(error)
      });
    }

    attemptStateAuthority.recordProvisioned({
      unitAddress: frozenScopeAuthority.unit_address,
      launchRef: input.monitor_handle,
      runId: input.run_id,
      retryId: provisioningRetryId
    });
    attemptStateAuthority.recordProvisioningBinding({
      unitAddress: frozenScopeAuthority.unit_address,
      launchRef: input.monitor_handle,
      runId: input.run_id,
      retryId: provisioningRetryId,
      provisioning
    });
    const provisionedWorktreeGitBinding = deriveProvisionedWorktreeGitBinding(provisioning);
    let executorResult;
    try {
      const {
        frozen_worker_scope_snapshot: _frozenWorkerScopeSnapshot,
        ...executorInput
      } = input;
      executorResult = await executor({
        ...executorInput,
        workspace_dir: provisioning.worktree_path,
        worktree_provisioning: provisioning,
        worker_scope_authority: frozenScopeAuthority,
        ...(provisionedWorktreeGitBinding
          ? {
              provisionedWorktreeGitBinding,
              provisioned_worktree_git_binding: provisionedWorktreeGitBinding
            }
          : {})
      });
      attemptStateAuthority.recordExecutorResult({
        unitAddress: frozenScopeAuthority.unit_address,
        launchRef: input.monitor_handle,
        runId: input.run_id,
        retryId: provisioningRetryId,
        result: executorResult
      });
      return executorResult;
    } catch (error) {
      attemptStateAuthority.recordExecutorResult({
        unitAddress: frozenScopeAuthority.unit_address,
        launchRef: input.monitor_handle,
        runId: input.run_id,
        retryId: provisioningRetryId,
        result: null,
        threw: true
      });
      throw error;
    }
  };
}

export function maybeWrapRegistryEntryWithWorktreeProvisioning(
  entry,
  app,
  provisioningConfig,
  requireManagedProvisioning,
  attemptStateAuthority,
  validateWorkerScopeSnapshot
) {
  if (!entry || typeof entry !== "object" || typeof entry.executor !== "function") {
    return entry;
  }
  return {
    ...entry,
    executor: maybeWrapExecutorWithWorktreeProvisioning(
      entry.executor,
      app,
      provisioningConfig,
      requireManagedProvisioning,
      attemptStateAuthority,
      validateWorkerScopeSnapshot
    )
  };
}

export function managedLifecycleCapabilityFact(available, source) {
  return Object.freeze({
    available: available === true,
    source,
    freshness: Object.freeze({ state: "fresh", basis: "current_backend_instance" })
  });
}
