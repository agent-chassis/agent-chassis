

import { computeWorkRecordSourceDigest } from "@agent-chassis/wiki-core";
import {
  WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER,
  CALLER_SCOPE_CARRIERS,
  CALLER_MANAGED_LIFECYCLE_CARRIERS
} from "./backend-constants.mjs";
import {
  isPlainObject,
  createRetainedReviewerLaunchIdentity,
  createRetainedSliceReviewerLaunchIdentity
} from "./backend-review-identity.mjs";
import {
  scopeAuthorityRefusal,
  firstOwnField,
  deepFreezeCanonicalSnapshot,
  resolveFrozenWorkerScopeAuthority,
  readCanonicalWorkRecord
} from "./backend-scope-authority.mjs";
import {
  managedRefusal,
  MANAGED_PROVISIONING_UNAVAILABLE,
  MANAGED_LIFECYCLE_REQUIRED,
  resolveExactSliceDependencies
} from "./backend-provisioning-state.mjs";

export function createBackendScope(ctx) {
  const {
    worktreeProvisioningConfig,
    requireManagedProvisioning,
    registeredWorkerScopeSnapshots,
    frozenSliceReviewContexts,
    frozenReviewContexts
  } = ctx;

  function workerScopeSnapshotRefusal(reason, detail = null) {
    return {
      ok: false,
      refusal: scopeAuthorityRefusal(WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER, {
        reason,
        ...detail
      }).refusal
    };
  }

  function freezeWorkerScopeSnapshot({ input, role, subject }) {
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
    const dependencies = resolveExactSliceDependencies(
      worktreeProvisioningConfig.mainRepo,
      subject,
      worktreeProvisioningConfig.deps ?? {}
    );
    if (!dependencies.ok) {
      return { ok: false, refusal: managedRefusal(MANAGED_LIFECYCLE_REQUIRED, dependencies).refusal };
    }
    try {
      const record = deepFreezeCanonicalSnapshot(dependencies.record);
      const selectedUnitContract = record.slices.find(
        (candidate) => candidate?.id === dependencies.slice.id
      );
      const authority = resolveFrozenWorkerScopeAuthority({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        subject,
        record,
        slice: selectedUnitContract
      });
      const snapshot = Object.freeze({
        authority,
        record,
        selected_unit_contract: selectedUnitContract
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

  return {
    workerScopeSnapshotRefusal,
    freezeWorkerScopeSnapshot,
    validateWorkerScopeSnapshot,
    deriveReviewerLaunchIdentity
  };
}
