

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

import {
  AGENT_ROLE_RESULT_COUNT_FIELDS,
  parseAgentRoleResult
} from "@agent-chassis/agent-launch-core/src/lib/agent-role-result.mjs";
import { existsSync } from "node:fs";
import path from "node:path";

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

export {
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_UNAVAILABLE_REASON
} from "./host-write-authority-substrate.mjs";

import { HOST_WRITE_AUTHORITY_FORBIDDEN_TOKENS } from "./host-write-authority-substrate.mjs";
import {
  computeWorkRecordSourceDigest
} from "@agent-chassis/wiki-core";
import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  defaultRunIdFactory,
  defaultMonitorHandleFactory
} from "./workspace-agent-dispatch-refusal.mjs";
import { createDispatchRunLifecycle } from "./workspace-agent-dispatch-run-lifecycle.mjs";
import { deriveBackendReviewResult } from "./workspace-agent-dispatch-review-result.mjs";
import {
  createExactSliceReviewReceipt,
  createExactSliceReviewReceiptStore,
  digestTrustedExactReviewEvidence,
  reviseExactSliceReviewReceipt
} from "./workspace-agent-dispatch-run-receipt.mjs";

import {
  mintAndPersistSliceReviewAcceptanceProof,
  resolveHistoricalSliceReviewAcceptanceProof,
  resolveSliceReviewAcceptanceProof
} from "@agent-chassis/wiki-core/src/operations/work-record-slice-review-acceptance.mjs";
import { AGENT_LAUNCH_ROLE_CONFIG_FILENAME } from "./agent-launch-role-config.mjs";
import { defaultRunGit } from "./worktree-substrate.mjs";
import {
  resolveUniqueManagedLifecycleBindingPairForRecovery
} from "./worktree-substrate-identity.mjs";

import {
  WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER,
  CALLER_SCOPE_CARRIERS,
  CALLER_MANAGED_LIFECYCLE_CARRIERS,
  CALLER_REVIEW_CONTEXT_CARRIERS,
  CONFIG_ATTEMPT_STATE_CARRIERS,
  FROZEN_REVIEW_CONTEXT_STATES,
  EXACT_IMPLEMENTATION_SLICE_RE
} from "./backend-constants.mjs";
import {
  hasExactClosedInputCommitComposition,
  isPlainObject,
  createRetainedReviewerLaunchIdentity,
  assertRetainedReviewerLaunchIdentityMatchesContext,
  createTrustedFrozenReviewContract,
  createTrustedFrozenSliceReviewContract,
  createRetainedSliceReviewerLaunchIdentity,
  assertRetainedSliceReviewerLaunchIdentityMatchesContext,
  hasManagedConfinementActivation
} from "./backend-review-identity.mjs";
import {
  scopeAuthorityRefusal,
  firstOwnField,
  deepFreezeCanonicalSnapshot,
  resolveFrozenWorkerScopeAuthority,
  readCanonicalWorkRecord,
  assertFrozenReviewTarget,
  resolveCanonicalFindingsOnlyReviewUnit,
  verifyFrozenWkReviewTargetAgainstObjectStore,
  assertFrozenSliceReviewTarget,
  verifyFrozenSliceReviewTargetAgainstObjectStore,
  resolveCanonicalSliceReviewUnit,
  resolveFrozenSliceReviewReceiptContract,
  resolveCanonicalIntegratedSliceState,
  verifyFrozenReceiptObjectsAgainstObjectStore
} from "./backend-scope-authority.mjs";
import { reconcileIntegratedSliceRecord } from "./slice-integration.mjs";
import {
  normalizeProvisioningConfig,
  createLauncherOwnedManagedAttemptStateAuthority,
  managedRefusal,
  MANAGED_PROVISIONING_UNAVAILABLE,
  MANAGED_LIFECYCLE_REQUIRED,
  resolveExactSliceDependencies
} from "./backend-provisioning-state.mjs";
import {
  maybeWrapExecutorWithWorktreeProvisioning,
  maybeWrapRegistryEntryWithWorktreeProvisioning,
  managedLifecycleCapabilityFact
} from "./backend-worktree-binding.mjs";

export const BACKEND_FORBIDDEN_ENVELOPE_TOKENS = HOST_WRITE_AUTHORITY_FORBIDDEN_TOKENS;

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
    prepareSourceToolSurface = null,

    proveAssignedSourceReadable = null
  } = options;
  const worktreeProvisioningConfig = normalizeProvisioningConfig(options.worktreeProvisioning);

  const requireManagedProvisioning = options.requireManagedProvisioning === true;
  const attemptStateAuthority = createLauncherOwnedManagedAttemptStateAuthority();
  const registeredWorkerScopeSnapshots = new WeakSet();
  const frozenReviewContexts = new Map();

  const frozenSliceReviewContexts = new Map();
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
  const reviewContextRunGit = options.reviewContextRunGit ?? defaultRunGit;
  const closedInputCommitCompositionInstalled = hasExactClosedInputCommitComposition(
    options.closedInputCommitComposition
  );

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
      result?.worker_scope_authority,
      result?.source_tool_surface,
      result?.sourceToolSurface
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

  const executors = {};
  const executorRegistryEntries = {};

  const familyAwareWiring = !!(launchExecutors && typeof launchExecutors === "object");
  if (familyAwareWiring) {
    for (const app of BACKEND_SUPPORTED_APPS) {
      const candidate = launchExecutors[app];
      if (typeof candidate === "function") {
        executors[app] = maybeWrapExecutorWithWorktreeProvisioning(
          candidate,
          app,
          worktreeProvisioningConfig,
          requireManagedProvisioning,
          attemptStateAuthority,
          validateWorkerScopeSnapshot
        );
        executorRegistryEntries[app] = executors[app];
      } else if (candidate && typeof candidate === "object" && typeof candidate.executor === "function") {
        const wrapped = maybeWrapRegistryEntryWithWorktreeProvisioning(
          candidate,
          app,
          worktreeProvisioningConfig,
          requireManagedProvisioning,
          attemptStateAuthority,
          validateWorkerScopeSnapshot
        );
        executors[app] = wrapped.executor;
        executorRegistryEntries[app] = wrapped;
      }
    }
  } else if (typeof launchExecutor === "function") {
    executors.codex = maybeWrapExecutorWithWorktreeProvisioning(
      launchExecutor,
      "codex",
      worktreeProvisioningConfig,
      requireManagedProvisioning,
      attemptStateAuthority,
      validateWorkerScopeSnapshot
    );
    executorRegistryEntries.codex = executors.codex;
  }

  const runs = new Map();

  function deriveReviewerLaunchIdentity({ role, subject, workspace_dir: workspaceDir }) {
    if (role !== "reviewer") return null;

    const sliceContext = frozenSliceReviewContexts.get(subject) ?? null;
    if (sliceContext !== null) {
      if (sliceContext.reservation_state !== FROZEN_REVIEW_CONTEXT_STATES.RESERVED ||
          workspaceDir !== sliceContext.worktree_path) {
        throw new Error("backend-owned frozen slice reviewer launch identity is not reserved for this exact slice worktree");
      }
      return createRetainedSliceReviewerLaunchIdentity(sliceContext);
    }
    const context = frozenReviewContexts.get(subject) ?? null;
    if (context === null) return null;
    if (context.reservation_state !== FROZEN_REVIEW_CONTEXT_STATES.RESERVED ||
        workspaceDir !== context.worktree_path) {
      throw new Error("backend-owned frozen reviewer launch identity is not reserved for this exact worktree");
    }
    return createRetainedReviewerLaunchIdentity(context);
  }

  const sliceReviewAcceptanceMints = new Map();

  function sliceReviewAcceptanceMintRefusal(reason, detail = null) {
    return Object.freeze({
      ok: false,
      decision_code: "agent_launch.slice_integration.review_acceptance_proof_not_minted.v1",
      reasons: detail === null ? [reason] : [reason, detail]
    });
  }

  async function resolveSliceReviewAcceptanceMint({ record, reviewResult }) {
    const context = frozenSliceReviewContexts.get(record.subject) ?? null;
    if (context === null || context.slice_level_review !== true) {
      return sliceReviewAcceptanceMintRefusal("no_frozen_slice_review_context");
    }

    if (context.reservation_state !== FROZEN_REVIEW_CONTEXT_STATES.CONSUMED ||
        context.consumed_by_run_id !== record.run_id ||
        context.review_subject !== record.subject) {
      return sliceReviewAcceptanceMintRefusal("frozen_slice_review_context_not_consumed_by_this_run");
    }
    try {

      assertRetainedSliceReviewerLaunchIdentityMatchesContext(
        record.reviewer_launch_identity,
        context
      );
    } catch (error) {
      return sliceReviewAcceptanceMintRefusal(
        "retained_slice_reviewer_launch_identity_mismatch",
        error?.message ?? String(error)
      );
    }

    let currentUnit;
    try {
      currentUnit = resolveCanonicalSliceReviewUnit(context.main_repo, context.review_subject);
    } catch (error) {
      return sliceReviewAcceptanceMintRefusal(
        "canonical_slice_review_unit_unresolvable",
        error?.message ?? String(error)
      );
    }
    if (currentUnit.subject !== context.review_subject ||
        currentUnit.record_id !== context.record_id ||
        currentUnit.slice_id !== context.review_slice_id ||
        currentUnit.initiative !== context.initiative ||
        currentUnit.canonical_parent_wk_contract !== context.canonical_parent_wk_contract ||
        currentUnit.review_unit_contract !== context.review_unit_contract) {
      return sliceReviewAcceptanceMintRefusal("canonical_slice_review_unit_changed_after_freeze");
    }
    const targetVerification = verifyFrozenSliceReviewTargetAgainstObjectStore({
      mainRepo: context.main_repo,
      context,
      runGit: reviewContextRunGit
    });
    if (targetVerification.ok !== true) {
      return sliceReviewAcceptanceMintRefusal(
        "frozen_slice_review_target_object_store_verification_failed",
        JSON.stringify(targetVerification.detail ?? null)
      );
    }

    return mintAndPersistSliceReviewAcceptanceProof({
      dir: context.main_repo,
      unit_address: context.review_subject,
      review_result: reviewResult,
      reviewed_at: new Date(clock()).toISOString(),
      binding: {
        initiative: context.initiative,
        slice_ref: context.slice_ref,
        reviewed_sha: context.reviewed_sha,
        diff_base_sha: context.diff_base_sha,
        source_worker_run_id: context.source_worker_run_id,
        review_run_id: record.run_id,
        review_monitor_handle: record.monitor_handle,
        reviewer_role: record.role
      }
    });
  }

  async function mintSliceReviewAcceptance({ record, review_result: reviewResult }) {
    if (!isPlainObject(record) || record.role !== "reviewer" || record.terminal !== true) {
      return null;
    }
    const existing = sliceReviewAcceptanceMints.get(record.run_id);
    if (existing !== undefined) return existing;
    const pending = resolveSliceReviewAcceptanceMint({ record, reviewResult }).catch((error) =>
      sliceReviewAcceptanceMintRefusal(
        "slice_review_acceptance_mint_threw",
        error?.message ?? String(error)
      )
    );
    sliceReviewAcceptanceMints.set(record.run_id, pending);
    const outcome = await pending;

    if (outcome?.ok !== true) {
      sliceReviewAcceptanceMints.delete(record.run_id);
    }

    record.slice_review_acceptance_mint = Object.freeze({
      ok: outcome?.ok === true,
      decision_code: outcome?.decision_code ?? null,
      reasons: Object.freeze([...(Array.isArray(outcome?.reasons) ? outcome.reasons : [])])
    });
    return outcome;
  }

  function structuredReceiptOutcome(record) {
    const evidence = record?.final_result?.structured_role_result;
    if (evidence?.valid !== true || evidence?.claims?.reported_role !== "reviewer" ||
        evidence?.claims?.reported_subject !== record.subject) return null;
    if (record.terminal !== true || record.status !== "succeeded") return null;

    const clean = deriveBackendReviewResult(record);
    if (clean) {
      return Object.freeze({
        outcome: "clean",
        clean_review: true,
        review_result: deepFreezeCanonicalSnapshot(clean)
      });
    }

    if (evidence.claims.reported_outcome !== "changes_requested") return null;
    const parsed = parseAgentRoleResult(record?.final_result?.full_response?.text);
    if (parsed?.valid !== true || !isPlainObject(parsed.result)) return null;
    const result = parsed.result;
    if (result.reported_role !== "reviewer" || result.reported_subject !== record.subject ||
        result.reported_outcome !== "changes_requested") return null;
    if (!Array.isArray(result.findings) || result.findings.length === 0) return null;

    const counts = result.recomputed_finding_counts;
    const projected = evidence.finding_counts;
    if (!isPlainObject(counts) || !isPlainObject(projected)) return null;
    if (counts.total !== result.findings.length) return null;
    for (const field of AGENT_ROLE_RESULT_COUNT_FIELDS) {
      if (!Number.isInteger(counts[field]) || counts[field] !== projected[field]) return null;
    }
    return Object.freeze({
      outcome: "changes_requested",
      clean_review: false,
      findings: deepFreezeCanonicalSnapshot(result.findings),
      finding_counts: deepFreezeCanonicalSnapshot(counts)
    });
  }

  async function resolveTerminalMintedReplayReceipt(context, record, outcome) {
    if (outcome?.outcome !== "clean" || outcome.clean_review !== true) return null;
    if (record.terminal !== true || record.status !== "succeeded") return null;
    if (context.reservation_state !== FROZEN_REVIEW_CONTEXT_STATES.CONSUMED) return null;

    const existing = await exactSliceReviewReceiptStore.load({
      unit_address: context.review_subject,
      review_run_id: record.run_id
    });
    if (existing === null) return null;
    const terminalClean = existing.frozen_context_state === FROZEN_REVIEW_CONTEXT_STATES.CONSUMED &&
      existing.terminal_run_status === "succeeded" &&
      existing.proof_state === "minted" &&
      existing.structured_outcome?.outcome === "clean" &&
      existing.structured_outcome.clean_review === true;
    if (!terminalClean) return null;
    const boundToCurrentUnit = existing.unit_address === context.review_subject &&
      existing.record_id === context.record_id &&
      existing.slice_id === context.review_slice_id &&
      existing.initiative === context.initiative &&
      existing.review_run_id === record.run_id &&
      existing.review_monitor_handle === record.monitor_handle &&
      existing.reviewer_role === record.role &&
      existing.source_worker_run_id === context.source_worker_run_id &&
      existing.source_worker_monitor_handle === context.source_worker_monitor_handle &&
      existing.slice_ref === context.slice_ref &&
      existing.worktree_path === context.worktree_path &&
      existing.worktree_identity_digest === context.worktree_identity_digest &&
      existing.reviewed_sha === context.reviewed_sha &&
      existing.diff_base_sha === context.diff_base_sha;
    if (!boundToCurrentUnit) return null;

    if (digestTrustedExactReviewEvidence(existing.structured_outcome) !==
        digestTrustedExactReviewEvidence(outcome)) return null;
    return existing;
  }

  async function persistExactSliceReviewReceipt(context, record) {
    if (exactSliceReviewReceiptStore === null) return null;
    const minted = record.slice_review_acceptance_mint?.ok === true;
    const structuredOutcome = structuredReceiptOutcome(record);
    if (minted) {

      const replay = await resolveTerminalMintedReplayReceipt(context, record, structuredOutcome);
      if (replay !== null) return replay;
    }

    const receiptContract = minted
      ? resolveCanonicalSliceReviewUnit(context.main_repo, context.review_subject)
      : context;
    const receipt = createExactSliceReviewReceipt({
      unit_address: context.review_subject,
      record_id: context.record_id,
      slice_id: context.review_slice_id,
      initiative: context.initiative,
      canonical_parent_wk_contract: receiptContract.canonical_parent_wk_contract,
      canonical_parent_contract_digest:
        digestTrustedExactReviewEvidence(receiptContract.canonical_parent_wk_contract),
      slice_review_contract: receiptContract.review_unit_contract,
      slice_review_contract_digest:
        digestTrustedExactReviewEvidence(receiptContract.review_unit_contract),
      source_worker_run_id: context.source_worker_run_id,
      source_worker_monitor_handle: context.source_worker_monitor_handle,
      review_run_id: record.run_id,
      review_monitor_handle: record.monitor_handle,
      reviewer_role: record.role,
      slice_ref: context.slice_ref,
      worktree_path: context.worktree_path,
      worktree_identity: context.worktree_identity,
      worktree_identity_digest: context.worktree_identity_digest,
      reviewed_sha: context.reviewed_sha,
      diff_base_sha: context.diff_base_sha,
      frozen_context_state: context.reservation_state,
      terminal_run_status: record.status,
      structured_outcome: structuredOutcome,
      proof_state: minted ? "minted" : "unminted"
    });
    return exactSliceReviewReceiptStore.persist(receipt);
  }

  async function captureSliceReviewTerminalResult({ record }) {
    const context = frozenSliceReviewContexts.get(record?.subject) ?? null;
    if (context === null || context.slice_level_review !== true ||
        context.consumed_by_run_id !== record.run_id || record.role !== "reviewer") return null;
    return persistExactSliceReviewReceipt(context, record);
  }

  async function resolveCorrectiveFindingsContext({ subject, workspace_dir: workspaceDir }) {
    if (exactSliceReviewReceiptStore === null ||
        path.resolve(workspaceDir ?? "") !== worktreeProvisioningConfig?.mainRepo ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "")) return null;
    const receipt = await exactSliceReviewReceiptStore.loadLatest(subject);
    if (receipt === null || receipt.frozen_context_state !== FROZEN_REVIEW_CONTEXT_STATES.CONSUMED ||
        receipt.terminal_run_status !== "succeeded" ||
        receipt.structured_outcome?.outcome !== "changes_requested") return null;
    const current = resolveCanonicalSliceReviewUnit(worktreeProvisioningConfig.mainRepo, subject);
    if (digestTrustedExactReviewEvidence(current.canonical_parent_wk_contract) !== receipt.canonical_parent_contract_digest ||
        digestTrustedExactReviewEvidence(current.review_unit_contract) !== receipt.slice_review_contract_digest) return null;
    const context = {
      slice_ref: receipt.slice_ref,
      reviewed_sha: receipt.reviewed_sha,
      diff_base_sha: receipt.diff_base_sha
    };
    if (verifyFrozenSliceReviewTargetAgainstObjectStore({
      mainRepo: worktreeProvisioningConfig.mainRepo,
      context,
      runGit: reviewContextRunGit
    }).ok !== true) return null;
    return deepFreezeCanonicalSnapshot({
      schema_version: "workspace-agent-trusted-corrective-findings-context.v1",
      authority: "launcher_exact_review_receipt",
      unit_address: subject,
      source_worker_run_id: receipt.source_worker_run_id,
      source_worker_monitor_handle: receipt.source_worker_monitor_handle,
      review_run_id: receipt.review_run_id,
      review_monitor_handle: receipt.review_monitor_handle,
      reviewed_sha: receipt.reviewed_sha,
      diff_base_sha: receipt.diff_base_sha,
      findings: receipt.structured_outcome.findings,
      finding_counts: receipt.structured_outcome.finding_counts,
      trusted_evidence_digest: receipt.trusted_evidence_digest
    });
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
    prepareSourceToolSurface,
    freezeWorkerScopeSnapshot,
    validateWorkerScopeSnapshot,
    deriveReviewerLaunchIdentity,
    proveAssignedSourceReadable,

    mintSliceReviewAcceptance
    ,captureSliceReviewTerminalResult
    ,resolveCorrectiveFindingsContext
  });

  function resolveManagedRunBinding(status) {
    return attemptStateAuthority.resolveProvisioningBinding(status);
  }

  function assertConsumedReviewContextMayRotate({ existing, reviewUnit, target, worktreePath }) {
    if (existing.reservation_state !== FROZEN_REVIEW_CONTEXT_STATES.CONSUMED) {
      throw new Error("an available or reserved frozen whole-WK review context cannot be replaced");
    }
    const priorReviewerRun = typeof existing.consumed_by_run_id === "string"
      ? runs.get(existing.consumed_by_run_id)
      : null;
    if (!priorReviewerRun || priorReviewerRun.run_id !== existing.consumed_by_run_id) {
      throw new Error("consumed frozen whole-WK review context has no exact backend-owned reviewer run");
    }
    if (priorReviewerRun.role !== "reviewer" ||
        priorReviewerRun.subject !== existing.review_subject) {
      throw new Error("consumed frozen whole-WK review context does not match its backend-owned reviewer run");
    }
    if (priorReviewerRun.terminal !== true) {
      throw new Error("consumed frozen whole-WK review context reviewer run is not terminal");
    }
    assertRetainedReviewerLaunchIdentityMatchesContext(
      priorReviewerRun.reviewer_launch_identity,
      existing
    );
    if (existing.main_repo !== worktreeProvisioningConfig?.mainRepo ||
        existing.review_subject !== reviewUnit.subject ||
        existing.record_id !== reviewUnit.record_id ||
        existing.review_slice_id !== reviewUnit.slice_id ||
        existing.initiative !== reviewUnit.initiative ||
        existing.wk_ref !== target.ref ||
        existing.worktree_path !== worktreePath ||
        existing.canonical_parent_wk_contract !== reviewUnit.canonical_parent_wk_contract ||
        existing.review_unit_contract !== reviewUnit.review_unit_contract) {
      throw new Error("corrective frozen whole-WK review context changed canonical repository, subject, unit, initiative, ref, worktree, or contract identity");
    }
    if (target.sha === existing.wk_sha) {
      throw new Error("corrective frozen whole-WK review context replays the consumed WK target");
    }
  }

  function bindFrozenReviewContext({ status, provisioning, integration, reviewUnit }) {
    const target = assertFrozenReviewTarget(integration?.review_target);
    const wkBinding = provisioning?.wk_binding;
    const worktreePath = provisioning?.validation_worktree_path;
    const expectedWkRef = wkBinding?.output_branch?.startsWith("refs/heads/")
      ? wkBinding.output_branch
      : `refs/heads/${wkBinding?.output_branch ?? ""}`;
    if (!isPlainObject(reviewUnit) || typeof reviewUnit.subject !== "string" ||
        typeof reviewUnit.canonical_parent_wk_contract !== "string" ||
        typeof reviewUnit.review_unit_contract !== "string" || reviewUnit.parent_status !== "review" ||
        typeof reviewUnit.initiative !== "string" || !/^IN-\d{4}$/u.test(reviewUnit.initiative) ||
        target.ref !== `refs/heads/wk/${reviewUnit.initiative}/${reviewUnit.record_id}` ||
        !path.isAbsolute(worktreePath ?? "") ||
        worktreePath !== wkBinding?.worktree_path || expectedWkRef !== target.ref ||
        provisioning?.record_id !== reviewUnit.record_id ||
        status?.subject !== `${reviewUnit.record_id}#${provisioning?.slice_id}`) {
      throw new Error("backend-owned frozen review context does not match managed provisioning and canonical review identity");
    }

    if (frozenSliceReviewContexts.has(reviewUnit.subject)) {
      throw new Error("subject already bound to a slice-level review context; a whole-WK review context cannot coexist");
    }
    const existing = frozenReviewContexts.get(reviewUnit.subject) ?? null;
    if (existing !== null) {
      assertConsumedReviewContextMayRotate({
        existing,
        reviewUnit,
        target,
        worktreePath
      });
    }
    const trustedFrozenReviewContract = createTrustedFrozenReviewContract(reviewUnit);
    const context = Object.freeze({
      schema_version: "workspace-agent-frozen-wk-review-context.v1",
      review_subject: reviewUnit.subject,
      record_id: reviewUnit.record_id,
      review_slice_id: reviewUnit.slice_id,
      initiative: reviewUnit.initiative,
      canonical_parent_wk_contract: reviewUnit.canonical_parent_wk_contract,
      review_unit_contract: reviewUnit.review_unit_contract,
      trusted_frozen_review_contract: trustedFrozenReviewContract,
      main_repo: worktreeProvisioningConfig.mainRepo,
      worktree_path: worktreePath,
      wk_ref: target.ref,
      wk_sha: target.sha,
      diff_base_sha: target.diff_base_sha,
      diff_head_sha: target.diff_head_sha,
      diff_range: target.diff_range,
      complete_parent_wk_contract: true,
      accumulated_wk_diff: true,
      source_worker_run_id: status.run_id,
      source_worker_subject: status.subject,
      reservation_state: FROZEN_REVIEW_CONTEXT_STATES.AVAILABLE,

      consumed: false,
      consumed_by_run_id: null
    });
    frozenReviewContexts.set(reviewUnit.subject, context);
    return context;
  }

  function assertConsumedSliceReviewContextMayRotate({ existing, reviewUnit, sliceTarget, worktreePath }) {
    if (existing.reservation_state !== FROZEN_REVIEW_CONTEXT_STATES.CONSUMED) {
      throw new Error("an available or reserved frozen slice review context cannot be replaced");
    }
    const priorReviewerRun = typeof existing.consumed_by_run_id === "string"
      ? runs.get(existing.consumed_by_run_id)
      : null;
    if (!priorReviewerRun || priorReviewerRun.run_id !== existing.consumed_by_run_id ||
        priorReviewerRun.role !== "reviewer" || priorReviewerRun.subject !== existing.review_subject ||
        priorReviewerRun.terminal !== true) {
      throw new Error("consumed frozen slice review context has no exact terminal backend-owned reviewer run");
    }

    assertRetainedSliceReviewerLaunchIdentityMatchesContext(
      priorReviewerRun.reviewer_launch_identity,
      existing
    );
    if (existing.main_repo !== worktreeProvisioningConfig?.mainRepo ||
        existing.review_subject !== reviewUnit.subject ||
        existing.record_id !== reviewUnit.record_id ||
        existing.review_slice_id !== reviewUnit.slice_id ||
        existing.initiative !== reviewUnit.initiative ||
        existing.slice_ref !== sliceTarget.ref ||
        existing.worktree_path !== worktreePath ||
        existing.canonical_parent_wk_contract !== reviewUnit.canonical_parent_wk_contract ||
        existing.review_unit_contract !== reviewUnit.review_unit_contract) {
      throw new Error("corrective frozen slice review context changed canonical repository, subject, unit, initiative, slice ref, worktree, or contract identity");
    }
    if (sliceTarget.sha === existing.reviewed_sha) {
      throw new Error("corrective frozen slice review context replays the consumed reviewed slice SHA");
    }
  }

  function bindFrozenSliceReviewContext({ status, provisioning, sliceTarget, reviewUnit }) {
    const target = assertFrozenSliceReviewTarget(sliceTarget);
    const sliceBinding = provisioning?.slice_binding;

    const worktreePath = provisioning?.slice_worktree_path ?? sliceBinding?.worktree_path;
    const expectedSliceRef = sliceBinding?.output_branch?.startsWith("refs/heads/")
      ? sliceBinding.output_branch
      : `refs/heads/${sliceBinding?.output_branch ?? ""}`;
    if (!isPlainObject(reviewUnit) || typeof reviewUnit.subject !== "string" ||
        typeof reviewUnit.canonical_parent_wk_contract !== "string" ||
        typeof reviewUnit.review_unit_contract !== "string" ||
        reviewUnit.parent_status === "review" ||
        typeof reviewUnit.initiative !== "string" || !/^IN-\d{4}$/u.test(reviewUnit.initiative) ||
        target.ref !== `refs/heads/slice/${reviewUnit.initiative}/${reviewUnit.record_id}/${reviewUnit.slice_id}` ||
        !path.isAbsolute(worktreePath ?? "") ||
        worktreePath !== sliceBinding?.worktree_path || expectedSliceRef !== target.ref ||
        provisioning?.record_id !== reviewUnit.record_id ||
        provisioning?.slice_id !== reviewUnit.slice_id ||
        status?.subject !== reviewUnit.subject) {
      throw new Error("backend-owned frozen slice review context does not match managed provisioning and canonical slice-review identity");
    }

    if (frozenReviewContexts.has(reviewUnit.subject)) {
      throw new Error("subject already bound to a whole-WK review context; a slice-level review context cannot coexist");
    }
    const existing = frozenSliceReviewContexts.get(reviewUnit.subject) ?? null;
    if (existing !== null) {
      if (existing.reservation_state === FROZEN_REVIEW_CONTEXT_STATES.CONSUMED &&
          existing.reviewed_sha === target.sha &&
          existing.diff_base_sha === target.diff_base_sha &&
          existing.source_worker_run_id === status.run_id) {
        return existing;
      }
      assertConsumedSliceReviewContextMayRotate({ existing, reviewUnit, sliceTarget: target, worktreePath });
    }
    const trustedFrozenReviewContract = createTrustedFrozenSliceReviewContract(reviewUnit);
    const context = Object.freeze({
      schema_version: "workspace-agent-frozen-slice-review-context.v1",
      review_subject: reviewUnit.subject,
      record_id: reviewUnit.record_id,
      review_slice_id: reviewUnit.slice_id,
      initiative: reviewUnit.initiative,
      canonical_parent_wk_contract: reviewUnit.canonical_parent_wk_contract,
      review_unit_contract: reviewUnit.review_unit_contract,
      trusted_frozen_review_contract: trustedFrozenReviewContract,
      main_repo: worktreeProvisioningConfig.mainRepo,
      worktree_path: worktreePath,
      slice_ref: target.ref,
      reviewed_sha: target.sha,
      diff_base_sha: target.diff_base_sha,
      diff_head_sha: target.diff_head_sha,
      diff_range: target.diff_range,
      slice_level_review: true,
      source_worker_run_id: status.run_id,
      source_worker_monitor_handle: status.monitor_handle ?? status.run_id,
      source_worker_subject: status.subject,
      worktree_identity: deepFreezeCanonicalSnapshot(sliceBinding),
      worktree_identity_digest: digestTrustedExactReviewEvidence(sliceBinding),
      reservation_state: FROZEN_REVIEW_CONTEXT_STATES.AVAILABLE,
      consumed: false,
      consumed_by_run_id: null
    });
    frozenSliceReviewContexts.set(reviewUnit.subject, context);
    return context;
  }

  function resolveSliceReviewAcceptanceBinding({ subject } = {}) {
    const context = frozenSliceReviewContexts.get(subject) ?? null;
    if (context === null || context.slice_level_review !== true) return null;

    if (context.reservation_state !== FROZEN_REVIEW_CONTEXT_STATES.CONSUMED ||
        typeof context.consumed_by_run_id !== "string" ||
        context.consumed_by_run_id.length === 0) {
      return null;
    }
    return Object.freeze({
      schema_version: "workspace-agent-slice-review-binding.v1",
      unit_address: context.review_subject,
      initiative: context.initiative,
      slice_ref: context.slice_ref,
      reviewed_sha: context.reviewed_sha,
      diff_base_sha: context.diff_base_sha,
      source_worker_run_id: context.source_worker_run_id,
      review_run_id: context.consumed_by_run_id
    });
  }

  const runPostWorkerSliceLifecycle = postWorkerSliceLifecycle === null
    ? null
    : async ({ workspace, status }) => postWorkerSliceLifecycle({
        workspace,
        status,
        deps: {
          resolveManagedRunBinding,
          resolveCanonicalReviewUnit: ({ mainRepo, wkId }) =>
            resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId),
          bindFrozenReviewContext,

          resolveCanonicalSliceReviewUnit: ({ mainRepo, subject }) =>
            resolveCanonicalSliceReviewUnit(mainRepo, subject),
          bindFrozenSliceReviewContext,

          resolveSliceReviewAcceptanceBinding
        }
      });

  const startSliceReviewLaunch = async (input, context) => {
    if (context.reservation_state === FROZEN_REVIEW_CONTEXT_STATES.CONSUMED) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "slice_context_review",
        reason: "frozen_slice_review_context_already_consumed",
        subject: input.subject
      });
    }
    if (context.reservation_state === FROZEN_REVIEW_CONTEXT_STATES.RESERVED) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "slice_context_review",
        reason: "frozen_slice_review_context_reserved",
        subject: input.subject
      });
    }
    if (path.resolve(input.workspace_dir ?? "") !== context.main_repo) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "slice_context_review",
        reason: "frozen_slice_review_context_workspace_mismatch"
      });
    }
    try {
      const currentUnit = resolveCanonicalSliceReviewUnit(context.main_repo, context.review_subject);
      if (currentUnit.subject !== context.review_subject ||
          currentUnit.record_id !== context.record_id ||
          currentUnit.slice_id !== context.review_slice_id ||
          currentUnit.initiative !== context.initiative ||
          currentUnit.parent_status === "review" ||
          currentUnit.canonical_parent_wk_contract !== context.canonical_parent_wk_contract ||
          currentUnit.review_unit_contract !== context.review_unit_contract) {
        throw new Error("canonical parent WK or implementation review unit changed after the slice target was frozen");
      }
    } catch (error) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "slice_context_review",
        reason: "frozen_slice_review_context_stale_or_mismatched",
        message: error?.message ?? String(error)
      });
    }
    const targetVerification = verifyFrozenSliceReviewTargetAgainstObjectStore({
      mainRepo: context.main_repo,
      context,
      runGit: reviewContextRunGit
    });
    if (targetVerification.ok !== true) {
      if (targetVerification.kind === "transport") {
        return managedRefusal(RUNTIME_BLOCKER_CODES.REVIEW_TRANSPORT_RUNTIME_FAILURE, {
          capability: "slice_context_review",
          reason: "frozen_slice_review_context_probe_transport_failure",
          detail: targetVerification.detail
        });
      }
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "slice_context_review",
        reason: "frozen_slice_review_context_stale_or_mismatched",
        detail: targetVerification.detail
      });
    }

    frozenSliceReviewContexts.set(input.subject, Object.freeze({
      ...context,
      reservation_state: FROZEN_REVIEW_CONTEXT_STATES.RESERVED
    }));
    let launch;
    try {
      launch = await lifecycle.startLaunch({
        ...input,

        workspace_dir: context.worktree_path,

        config_root_dir: context.main_repo,
        trusted_frozen_review_contract: context.trusted_frozen_review_contract,
        readiness: Object.freeze({
          ...(isPlainObject(input.readiness) ? input.readiness : {}),
          frozen_slice_review_target: Object.freeze({
            ref: context.slice_ref,
            sha: context.reviewed_sha,
            diff_base_sha: context.diff_base_sha,
            diff_head_sha: context.diff_head_sha,
            diff_range: context.diff_range,
            slice_level_review: true
          })
        })
      });
    } catch (error) {
      frozenSliceReviewContexts.set(input.subject, context);
      throw error;
    }
    if (launch?.accepted === true) {
      const consumedContext = Object.freeze({
        ...context,
        reservation_state: FROZEN_REVIEW_CONTEXT_STATES.CONSUMED,
        consumed: true,
        consumed_by_run_id: launch.run_id
      });
      frozenSliceReviewContexts.set(input.subject, consumedContext);
      const launchedRecord = runs.get(launch.run_id) ?? null;
      if (launchedRecord !== null) {

        if (launchedRecord.terminal === true) {
          const launchReviewResult = deriveBackendReviewResult(launchedRecord);
          if (launchReviewResult !== null) {
            await mintSliceReviewAcceptance({
              record: launchedRecord,
              review_result: launchReviewResult
            });
          }
        }
        await persistExactSliceReviewReceipt(consumedContext, launchedRecord);
      }
    } else {
      frozenSliceReviewContexts.set(input.subject, context);

      if (launch?.refusal?.reason === "reviewer_model_unset" &&
          !existsSync(path.join(context.main_repo, AGENT_LAUNCH_ROLE_CONFIG_FILENAME))) {
        return managedRefusal(RUNTIME_BLOCKER_CODES.REVIEW_TRANSPORT_RUNTIME_FAILURE, {
          capability: "slice_context_review",
          reason: "reviewer_role_config_root_unreadable",
          detail: {
            config_root: context.main_repo,
            config_file: AGENT_LAUNCH_ROLE_CONFIG_FILENAME
          }
        });
      }
    }
    return launch;
  };

  const isLauncherOwnedExactSliceReviewAdmission = ({ subject, workspace_dir: workspaceDir } = {}) => {
    const context = frozenSliceReviewContexts.get(subject) ?? null;
    if (context === null || context.slice_level_review !== true ||
        context.reservation_state !== FROZEN_REVIEW_CONTEXT_STATES.AVAILABLE ||
        path.resolve(workspaceDir ?? "") !== context.main_repo) return false;
    try {
      const current = resolveCanonicalSliceReviewUnit(context.main_repo, subject);
      if (current.canonical_parent_wk_contract !== context.canonical_parent_wk_contract ||
          current.review_unit_contract !== context.review_unit_contract) return false;
      return verifyFrozenSliceReviewTargetAgainstObjectStore({
        mainRepo: context.main_repo,
        context,
        runGit: reviewContextRunGit
      }).ok === true;
    } catch {
      return false;
    }
  };

  const startLaunch = async (input = {}) => {
    const correctiveCarrier = firstOwnField(input, [
      "trusted_corrective_findings_context",
      "corrective_findings_context",
      "review_findings_context"
    ]);
    const nestedCorrectiveCarrier = firstOwnField(input?.readiness, [
      "trusted_corrective_findings_context",
      "corrective_findings_context",
      "review_findings_context"
    ]);
    if (correctiveCarrier !== null || nestedCorrectiveCarrier !== null) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "trusted_corrective_findings",
        reason: "caller_carried_corrective_findings_forbidden",
        field: correctiveCarrier ?? `readiness.${nestedCorrectiveCarrier}`
      });
    }
    if (input?.role === "worker") {
      const callerCarrier = firstOwnField(input, CALLER_SCOPE_CARRIERS);
      const lifecycleCarrier = firstOwnField(input, CALLER_MANAGED_LIFECYCLE_CARRIERS);
      const configCarrier = firstOwnField(worktreeProvisioningConfig, CALLER_SCOPE_CARRIERS);
      const configAttemptCarrier = firstOwnField(worktreeProvisioningConfig, CONFIG_ATTEMPT_STATE_CARRIERS);
      if (callerCarrier !== null || lifecycleCarrier !== null || configCarrier !== null || configAttemptCarrier !== null) {
        return {
          schema_version: WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
          ...scopeAuthorityRefusal(WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER, {
            reason: lifecycleCarrier !== null || configAttemptCarrier !== null
              ? "caller_carried_managed_lifecycle_forbidden"
              : "caller_carried_scope_forbidden",
            field: callerCarrier ?? lifecycleCarrier ?? configCarrier ?? configAttemptCarrier,
            carrier: callerCarrier !== null || lifecycleCarrier !== null ? "dispatch_input" : "provisioning_config"
          })
        };
      }
    }
    if (input?.role !== "reviewer") {
      return lifecycle.startLaunch(input);
    }

    const contextCarrier = firstOwnField(input, CALLER_REVIEW_CONTEXT_CARRIERS);
    const nestedContextCarrier = firstOwnField(input?.readiness, CALLER_REVIEW_CONTEXT_CARRIERS);
    if (contextCarrier !== null || nestedContextCarrier !== null) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "caller_carried_review_context_forbidden",
        field: contextCarrier ?? `readiness.${nestedContextCarrier}`
      });
    }

    const sliceContext = frozenSliceReviewContexts.get(input.subject);
    if (sliceContext) {
      return startSliceReviewLaunch(input, sliceContext);
    }
    const context = frozenReviewContexts.get(input.subject);
    if (!context) {
      const subjectMatch = typeof input.subject === "string"
        ? input.subject.match(/^(WK-\d{4})#SLICE-\d{3}$/u)
        : null;
      if (subjectMatch) {
        const canonicalMainRepo = worktreeProvisioningConfig?.mainRepo ?? input.workspace_dir;
        const record = readCanonicalWorkRecord(canonicalMainRepo, subjectMatch[1]);
        if (!record) {
          return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
            capability: "wk_context_review",
            reason: "canonical_review_authority_unresolved",
            subject: input.subject
          });
        }
        if (record.status !== "review") {
          return lifecycle.startLaunch(input);
        }
        try {
          const canonicalUnit = resolveCanonicalFindingsOnlyReviewUnit(canonicalMainRepo, subjectMatch[1]);
          if (canonicalUnit.subject !== input.subject) {
            return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
              capability: "wk_context_review",
              reason: "canonical_review_subject_mismatch",
              subject: input.subject,
              canonical_subject: canonicalUnit.subject
            });
          }
        } catch (error) {
          return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
            capability: "wk_context_review",
            reason: "canonical_review_authority_unresolved",
            subject: input.subject,
            message: error?.message ?? String(error)
          });
        }
        return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
          capability: "wk_context_review",
          reason: "frozen_review_context_missing",
          subject: input.subject
        });
      }
      return lifecycle.startLaunch(input);
    }
    if (context.reservation_state === FROZEN_REVIEW_CONTEXT_STATES.CONSUMED) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "frozen_review_context_already_consumed",
        subject: input.subject
      });
    }
    if (context.reservation_state === FROZEN_REVIEW_CONTEXT_STATES.RESERVED) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "frozen_review_context_reserved",
        subject: input.subject
      });
    }
    if (path.resolve(input.workspace_dir ?? "") !== context.main_repo) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "frozen_review_context_workspace_mismatch"
      });
    }
    try {
      const currentUnit = resolveCanonicalFindingsOnlyReviewUnit(context.main_repo, context.record_id);
      if (currentUnit.subject !== context.review_subject ||
          currentUnit.record_id !== context.record_id ||
          currentUnit.slice_id !== context.review_slice_id ||
          currentUnit.initiative !== context.initiative ||
          currentUnit.parent_status !== "review" ||
          currentUnit.canonical_parent_wk_contract !== context.canonical_parent_wk_contract ||
          currentUnit.review_unit_contract !== context.review_unit_contract) {
        throw new Error("canonical parent WK or findings-only review unit changed after the WK target was frozen");
      }
    } catch (error) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "frozen_review_context_stale_or_mismatched",
        message: error?.message ?? String(error)
      });
    }
    const targetVerification = verifyFrozenWkReviewTargetAgainstObjectStore({
      mainRepo: context.main_repo,
      context,
      runGit: reviewContextRunGit
    });
    if (targetVerification.ok !== true) {
      if (targetVerification.kind === "transport") {

        return managedRefusal(RUNTIME_BLOCKER_CODES.REVIEW_TRANSPORT_RUNTIME_FAILURE, {
          capability: "wk_context_review",
          reason: "frozen_review_context_probe_transport_failure",
          detail: targetVerification.detail
        });
      }
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "frozen_review_context_stale_or_mismatched",
        detail: targetVerification.detail
      });
    }

    frozenReviewContexts.set(input.subject, Object.freeze({
      ...context,
      reservation_state: FROZEN_REVIEW_CONTEXT_STATES.RESERVED
    }));
    let launch;
    try {
      launch = await lifecycle.startLaunch({
        ...input,
        workspace_dir: context.worktree_path,

        config_root_dir: context.main_repo,
        trusted_frozen_review_contract: context.trusted_frozen_review_contract,
        readiness: Object.freeze({
          ...(isPlainObject(input.readiness) ? input.readiness : {}),
          frozen_wk_review_target: Object.freeze({
            ref: context.wk_ref,
            sha: context.wk_sha,
            diff_base_sha: context.diff_base_sha,
            diff_head_sha: context.diff_head_sha,
            diff_range: context.diff_range,
            complete_parent_wk_contract: true,
            accumulated_wk_diff: true
          })
        })
      });
    } catch (error) {
      frozenReviewContexts.set(input.subject, context);
      throw error;
    }
    if (launch?.accepted === true) {
      frozenReviewContexts.set(input.subject, Object.freeze({
        ...context,
        reservation_state: FROZEN_REVIEW_CONTEXT_STATES.CONSUMED,
        consumed: true,
        consumed_by_run_id: launch.run_id
      }));
    } else {

      frozenReviewContexts.set(input.subject, context);

      if (launch?.refusal?.reason === "reviewer_model_unset" &&
          !existsSync(path.join(context.main_repo, AGENT_LAUNCH_ROLE_CONFIG_FILENAME))) {
        return managedRefusal(RUNTIME_BLOCKER_CODES.REVIEW_TRANSPORT_RUNTIME_FAILURE, {
          capability: "wk_context_review",
          reason: "reviewer_role_config_root_unreadable",
          detail: {
            config_root: context.main_repo,
            config_file: AGENT_LAUNCH_ROLE_CONFIG_FILENAME
          }
        });
      }
    }
    return launch;
  };

  const recoverIntegratedWorkerRunInternal = async ({
    workspace,
    monitor_handle,
    subject,
    allowMissingSliceWorktree = false
  } = {}) => {
    if (postWorkerSliceLifecycle === null || !worktreeProvisioningConfig ||
        !workspace || path.resolve(workspace.dir ?? "") !== worktreeProvisioningConfig.mainRepo ||
        typeof monitor_handle !== "string" || typeof subject !== "string" ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject)) {
      return null;
    }
    const key = JSON.stringify([monitor_handle, subject, allowMissingSliceWorktree]);
    if (!recoveredIntegratedRuns.has(key)) {
      const recovery = (async () => {
        try {
          const pair = resolveUniqueManagedLifecycleBindingPairForRecovery({
            mainRepo: worktreeProvisioningConfig.mainRepo,
            launchRef: monitor_handle,
            expectedSubject: subject,
            allowMissingSliceWorktree
          });
          if (!pair) return null;

          const status = Object.freeze({
            accepted: true,
            recovered: true,
            run_id: pair.run_id,
            monitor_handle,
            app: null,
            role: "worker",
            subject,
            status: "succeeded",
            terminal: true,
            started_at: null,
            updated_at: null,
            exit: null,
            final_result: null
          });

          const lifecycleResult = await postWorkerSliceLifecycle({
            workspace,
            status,
            deps: {
              resolveManagedRunBinding: () => pair.provisioning,
              resolveCanonicalReviewUnit: ({ mainRepo, wkId }) =>
                resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId),
              bindFrozenReviewContext,
              recoveryOnly: true
            }
          });
          if (!lifecycleResult || lifecycleResult.phase !== "finalized" ||
              lifecycleResult.integration?.recovered !== true) {
            return null;
          }
          return Object.freeze({ status, lifecycle: lifecycleResult });
        } catch (error) {

          return Object.freeze({
            recovery_failure: Object.freeze({
              code: typeof error?.code === "string"
                ? error.code
                : "agent_launch.slice_lifecycle.recovery_failed.v1",
              message: error?.message ?? String(error),
              detail: error?.detail ?? null
            })
          });
        }
      })();
      recoveredIntegratedRuns.set(key, recovery);
    }
    const pending = recoveredIntegratedRuns.get(key);
    const result = await pending;
    if ((result === null || result.recovery_failure != null) &&
        recoveredIntegratedRuns.get(key) === pending) {

      recoveredIntegratedRuns.delete(key);
    }
    return result;
  };

  const recoverIntegratedWorkerRun = (input = {}) =>
    recoverIntegratedWorkerRunInternal({ ...input, allowMissingSliceWorktree: true });

  const recoveredExactReviewRuns = new Map();
  const recoverExactSliceReviewRun = async ({ workspace, monitor_handle, subject } = {}) => {
    if (postWorkerSliceLifecycle === null || exactSliceReviewReceiptStore === null ||
        !workspace || path.resolve(workspace.dir ?? "") !== worktreeProvisioningConfig?.mainRepo ||
        typeof monitor_handle !== "string" || typeof subject !== "string" ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject)) return null;
    const key = JSON.stringify([subject, monitor_handle]);
    if (!recoveredExactReviewRuns.has(key)) {
      recoveredExactReviewRuns.set(key, (async () => {
        const receipt = await exactSliceReviewReceiptStore.load({
          unit_address: subject,
          monitor_handle
        });
        if (receipt === null) return null;
        if (receipt.frozen_context_state !== FROZEN_REVIEW_CONTEXT_STATES.CONSUMED ||
            receipt.terminal_run_status !== "succeeded" ||
            receipt.structured_outcome?.outcome !== "clean" ||
            receipt.structured_outcome.clean_review !== true ||
            receipt.proof_state !== "minted") return null;

        const frozen = resolveFrozenSliceReviewReceiptContract(receipt);
        const pair = resolveUniqueManagedLifecycleBindingPairForRecovery({
          mainRepo: worktreeProvisioningConfig.mainRepo,
          launchRef: receipt.source_worker_monitor_handle,
          expectedSubject: subject,
          allowMissingSliceWorktree: true
        });
        const sliceBinding = pair?.provisioning?.slice_binding;
        if (!pair || pair.run_id !== receipt.source_worker_run_id ||
            sliceBinding?.worktree_path !== receipt.worktree_path ||
            sliceBinding?.base_sha !== receipt.diff_base_sha ||
            sliceBinding?.unit_address !== `${receipt.initiative}/${receipt.record_id}/${receipt.slice_id}` ||
            sliceBinding?.launch_ref !== receipt.source_worker_monitor_handle ||
            sliceBinding?.run_id !== `${receipt.source_worker_run_id}.slice` ||
            digestTrustedExactReviewEvidence(sliceBinding) !== receipt.worktree_identity_digest) {
          throw new Error("exact slice review receipt retained identity no longer matches");
        }
        const sliceRef = sliceBinding.output_branch.startsWith("refs/heads/")
          ? sliceBinding.output_branch
          : `refs/heads/${sliceBinding.output_branch}`;
        if (sliceRef !== receipt.slice_ref) {
          throw new Error("exact slice review receipt retained slice ref no longer matches");
        }

        let currentReview = null;
        try {
          currentReview = resolveCanonicalSliceReviewUnit(worktreeProvisioningConfig.mainRepo, subject);
        } catch {
          currentReview = null;
        }
        let recoveredIntegration = null;
        if (currentReview !== null) {
          if (digestTrustedExactReviewEvidence(currentReview.canonical_parent_wk_contract) !==
                receipt.canonical_parent_contract_digest ||
              digestTrustedExactReviewEvidence(currentReview.review_unit_contract) !==
                receipt.slice_review_contract_digest ||
              currentReview.initiative !== receipt.initiative) {
            throw new Error("exact slice review receipt no longer matches the canonical pre-integration contract");
          }
        } else {
          const integratedState = resolveCanonicalIntegratedSliceState(
            worktreeProvisioningConfig.mainRepo,
            subject,
            frozen
          );
          const wkRef = `refs/heads/wk/${receipt.initiative}/${receipt.record_id}`;
          recoveredIntegration = reconcileIntegratedSliceRecord({
            mainRepo: worktreeProvisioningConfig.mainRepo,
            unitAddress: sliceBinding.unit_address,
            sliceRef: receipt.slice_ref,
            wkRef,
            deps: { runGit: reviewContextRunGit }
          });
          if (recoveredIntegration === null || recoveredIntegration.integrated !== true ||
              recoveredIntegration.recovered !== true || recoveredIntegration.wk_ref !== wkRef ||
              recoveredIntegration.slice_ref !== receipt.slice_ref ||
              recoveredIntegration.integrated_state !== (integratedState.final ? "final" : "non_final") ||
              (integratedState.final !== (recoveredIntegration.review_target !== null))) {
            throw new Error("exact slice review receipt current integrated state is missing or mismatched");
          }
          const historicalObjects = verifyFrozenReceiptObjectsAgainstObjectStore({
            mainRepo: worktreeProvisioningConfig.mainRepo,
            receipt,
            runGit: reviewContextRunGit
          });
          if (historicalObjects.ok !== true) {
            throw new Error("exact slice review receipt reviewed objects are missing or mismatched");
          }
        }
        const context = Object.freeze({
          schema_version: "workspace-agent-frozen-slice-review-context.v1",
          review_subject: subject,
          record_id: receipt.record_id,
          review_slice_id: receipt.slice_id,
          initiative: receipt.initiative,
          canonical_parent_wk_contract: frozen.canonical_parent_wk_contract,
          review_unit_contract: frozen.review_unit_contract,
          trusted_frozen_review_contract: createTrustedFrozenSliceReviewContract(frozen),
          main_repo: worktreeProvisioningConfig.mainRepo,
          worktree_path: receipt.worktree_path,
          slice_ref: receipt.slice_ref,
          reviewed_sha: receipt.reviewed_sha,
          diff_base_sha: receipt.diff_base_sha,
          diff_head_sha: receipt.reviewed_sha,
          diff_range: `${receipt.diff_base_sha}..${receipt.reviewed_sha}`,
          slice_level_review: true,
          source_worker_run_id: receipt.source_worker_run_id,
          source_worker_monitor_handle: receipt.source_worker_monitor_handle,
          source_worker_subject: subject,
          worktree_identity: receipt.worktree_identity,
          worktree_identity_digest: receipt.worktree_identity_digest,
          reservation_state: FROZEN_REVIEW_CONTEXT_STATES.CONSUMED,
          consumed: true,
          consumed_by_run_id: receipt.review_run_id
        });
        if (recoveredIntegration === null) {
          const targetVerification = verifyFrozenSliceReviewTargetAgainstObjectStore({
            mainRepo: context.main_repo,
            context,
            runGit: reviewContextRunGit
          });
          if (targetVerification.ok !== true) {
            throw new Error("exact slice review receipt target is missing or mismatched");
          }
        }
        frozenSliceReviewContexts.set(subject, context);
        const reviewerRecord = {
          run_id: receipt.review_run_id,
          monitor_handle: receipt.review_monitor_handle,
          role: "reviewer",
          subject,
          status: "succeeded",
          terminal: true,
          reviewer_launch_identity: createRetainedSliceReviewerLaunchIdentity(context)
        };
        const expectation = {
          unit_address: subject,
          initiative: context.initiative,
          slice_ref: context.slice_ref,
          reviewed_sha: context.reviewed_sha,
          diff_base_sha: context.diff_base_sha,
          source_worker_run_id: context.source_worker_run_id,
          review_run_id: receipt.review_run_id,
          review_monitor_handle: receipt.review_monitor_handle,
          reviewer_role: "reviewer",
          current_slice_sha: context.reviewed_sha
        };
        if (recoveredIntegration === null) {
          let proof = await resolveSliceReviewAcceptanceProof({
            dir: context.main_repo,
            unit_address: subject,
            expectation
          });
          if (proof?.ok !== true) {
            proof = await resolveSliceReviewAcceptanceMint({
              record: reviewerRecord,
              reviewResult: receipt.structured_outcome.review_result
            });
          }
          if (proof?.ok !== true) return null;
          await exactSliceReviewReceiptStore.persist(
            reviseExactSliceReviewReceipt(receipt, { proof_state: "minted" })
          );
        } else {
          const proof = await resolveHistoricalSliceReviewAcceptanceProof({
            dir: context.main_repo,
            unit_address: subject,
            expectation,
            historical_contract: {
              canonical_parent_wk_contract: receipt.canonical_parent_wk_contract,
              canonical_parent_contract_digest: receipt.canonical_parent_contract_digest,
              slice_review_contract: receipt.slice_review_contract,
              slice_review_contract_digest: receipt.slice_review_contract_digest
            },
            review_result: receipt.structured_outcome.review_result
          });
          if (proof?.ok !== true) {
            throw new Error(
              `exact slice review historical Proof A is missing or mismatched: ${
                Array.isArray(proof?.reasons) ? proof.reasons.join("; ") : "unknown refusal"
              }`
            );
          }
        }

        if (recoveredIntegration !== null) {
          const alreadyIntegrated = await recoverIntegratedWorkerRunInternal({
            workspace,
            monitor_handle: receipt.source_worker_monitor_handle,
            subject,
            allowMissingSliceWorktree: true
          });
          if (alreadyIntegrated?.status?.accepted !== true || !alreadyIntegrated.lifecycle) {
            throw new Error(
              alreadyIntegrated?.recovery_failure?.message ??
              "exact slice review receipt integrated lifecycle could not be recovered"
            );
          }
          return Object.freeze({
            status: Object.freeze({
              accepted: true,
              recovered: true,
              run_id: receipt.review_run_id,
              monitor_handle: receipt.review_monitor_handle,
              role: "reviewer",
              subject,
              status: "succeeded",
              terminal: true,
              review_result: receipt.structured_outcome.review_result,
              final_result: null
            }),
            lifecycle: alreadyIntegrated.lifecycle
          });
        }
        const workerStatus = Object.freeze({
          accepted: true,
          recovered: true,
          run_id: receipt.source_worker_run_id,
          monitor_handle: receipt.source_worker_monitor_handle,
          role: "worker",
          subject,
          status: "succeeded",
          terminal: true
        });
        const lifecycleResult = await postWorkerSliceLifecycle({
          workspace,
          status: workerStatus,
          deps: {
            resolveManagedRunBinding: () => pair.provisioning,
            resolveCanonicalReviewUnit: ({ mainRepo, wkId }) =>
              resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId),
            bindFrozenReviewContext,
            resolveCanonicalSliceReviewUnit: ({ mainRepo, subject: unit }) =>
              resolveCanonicalSliceReviewUnit(mainRepo, unit),
            bindFrozenSliceReviewContext,
            resolveSliceReviewAcceptanceBinding
          }
        });
        return Object.freeze({
          status: Object.freeze({
            accepted: true,
            recovered: true,
            run_id: receipt.review_run_id,
            monitor_handle: receipt.review_monitor_handle,
            role: "reviewer",
            subject,
            status: "succeeded",
            terminal: true,
            review_result: receipt.structured_outcome.review_result,
            final_result: null
          }),
          lifecycle: lifecycleResult
        });
      })());
    }
    try {
      const result = await recoveredExactReviewRuns.get(key);
      if (result === null) recoveredExactReviewRuns.delete(key);
      return result;
    } catch (error) {
      recoveredExactReviewRuns.delete(key);
      return Object.freeze({ recovery_failure: Object.freeze({
        code: "agent_launch.exact_slice_review_receipt_recovery_failed.v1",
        message: error?.message ?? String(error)
      }) });
    }
  };

  const getManagedLifecycleCapabilityAuthorityFacts = async () => Object.freeze({
    native_edit: managedLifecycleCapabilityFact(
      Object.keys(executors).length > 0,
      "agent_launch.dispatch_backend.executor_registry"
    ),
    repository_read_boundary: managedLifecycleCapabilityFact(
      hasManagedConfinementActivation(worktreeProvisioningConfig),
      "agent_launch.dispatch_backend.repository_read_boundary"
    ),
    commit: managedLifecycleCapabilityFact(
      closedInputCommitCompositionInstalled,
      "agent_launch.dispatch_backend.closed_input_commit_composition"
    ),
    managed_worktree_provisioning: managedLifecycleCapabilityFact(
      worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.worktree_provisioning"
    ),
    slice_to_wk_integration: managedLifecycleCapabilityFact(
      postWorkerSliceLifecycle !== null && worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.terminal_slice_integration"
    ),
    wk_context_review: managedLifecycleCapabilityFact(
      postWorkerSliceLifecycle !== null && worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.frozen_wk_review_context"
    ),

    slice_context_review: managedLifecycleCapabilityFact(
      postWorkerSliceLifecycle !== null && worktreeProvisioningConfig !== null && requireManagedProvisioning,
      "agent_launch.dispatch_backend.frozen_slice_review_context"
    ),
    automatic_main_promotion: managedLifecycleCapabilityFact(
      false,
      "agent_launch.dispatch_backend.main_promotion_unwired"
    )
  });

  return {
    schema_version: WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
    startLaunch,
    getRunStatus: lifecycle.getRunStatus,
    waitForRunStatus: lifecycle.waitForRunStatus,
    planLaunch: lifecycle.planLaunch,
    getManagedLifecycleCapabilityAuthorityFacts,
    isLauncherOwnedExactSliceReviewAdmission,

    resolveSliceReviewAcceptanceBinding,
    ...(runPostWorkerSliceLifecycle !== null
      ? { runPostWorkerSliceLifecycle, recoverIntegratedWorkerRun, recoverExactSliceReviewRun }
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
