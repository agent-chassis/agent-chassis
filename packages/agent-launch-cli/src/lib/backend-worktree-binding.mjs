

import path from "node:path";
import {
  WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER
} from "./backend-constants.mjs";
import { isPlainObject } from "./backend-review-identity.mjs";
import {
  scopeAuthorityRefusal,
  assertProvisionedScopeAuthority
} from "./backend-scope-authority.mjs";
import { resolveProvisioningAttemptState } from "./backend-provisioning-state.mjs";

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

function preparationRefusal(result) {
  return Object.freeze({
    ok: false,
    refusal: result?.refusal ?? result
  });
}

export function createManagedWorktreeProvisioningAuthority({
  provisioningConfig: _provisioningConfig,
  requireManagedProvisioning: _requireManagedProvisioning,
  attemptStateAuthority
} = {}) {
  const prepared = new WeakMap();

  function admitEstablished({ input = {}, app, state } = {}) {
    if (!isPlainObject(state) || state.provisioning?.complete !== true ||
        state.subject !== input.subject || state.run_id !== input.run_id ||
        state.monitor_handle !== input.monitor_handle || state.app !== app) {
      return preparationRefusal(scopeAuthorityRefusal(
        WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER,
        { reason: "launcher_private_provisioning_unavailable" }
      ));
    }
    const ticket = Object.freeze({});
    prepared.set(ticket, Object.freeze({ ...state }));
    return Object.freeze({ ok: true, ticket });
  }

  function resolve({ ticket, input = null, app = null, consume = false } = {}) {
    const state = ticket !== null && typeof ticket === "object"
      ? prepared.get(ticket) ?? null
      : null;
    if (state === null) return null;
    if (input !== null && (
      state.app !== app ||
      state.subject !== input.subject ||
      state.run_id !== input.run_id ||
      state.monitor_handle !== input.monitor_handle
    )) return null;
    if (consume) prepared.delete(ticket);
    return state;
  }

  const resolveAttemptState = ({ input, initiative }) =>
    resolveProvisioningAttemptState({ attemptStateAuthority, input, initiative });

  return Object.freeze({ admitEstablished, resolve, resolveAttemptState });
}

export function maybeWrapExecutorWithWorktreeProvisioning(
  executor,
  app,
  provisioningConfig,
  requireManagedProvisioning,
  attemptStateAuthority,
  validateWorkerScopeSnapshot,
  provisioningAuthority = null
) {
  if (typeof executor !== "function") return executor;
  if (provisioningConfig === null && requireManagedProvisioning !== true) return executor;
  const authority = provisioningAuthority ?? createManagedWorktreeProvisioningAuthority({
    provisioningConfig,
    requireManagedProvisioning,
    attemptStateAuthority
  });
  return async function provisionedWorkspaceAgentExecutor(input = {}) {
    if (input.role !== "worker") return executor(input);

    const frozenScopeSnapshot = input.frozen_worker_scope_snapshot ?? null;
    const ticket = frozenScopeSnapshot?.managed_provisioning_ticket ?? null;
    const preparedState = authority.resolve({ ticket, input, app, consume: true });
    if (preparedState === null) {
      return scopeAuthorityRefusal(WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER, {
        reason: "launcher_private_provisioning_unavailable"
      });
    }
    const { provisioning, initiative, retry_id: provisioningRetryId } = preparedState;
    const snapshotValidation = typeof validateWorkerScopeSnapshot === "function"
      ? await validateWorkerScopeSnapshot({
          snapshot: frozenScopeSnapshot,
          consumer: "provisioning",
          result: provisioning
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
  validateWorkerScopeSnapshot,
  provisioningAuthority = null
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
      validateWorkerScopeSnapshot,
      provisioningAuthority
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
