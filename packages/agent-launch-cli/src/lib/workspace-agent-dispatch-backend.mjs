

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

import { DISPATCH_FORBIDDEN_ENVELOPE_TOKENS } from "./dispatch-envelope-policy.mjs";
import {
  computeWorkRecordSourceDigest,
  setWorkRecordStatusByUnit
} from "@agent-chassis/wiki-core";
import { RUNTIME_BLOCKER_CODES } from "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";

import {
  defaultRunIdFactory,
  defaultMonitorHandleFactory
} from "./workspace-agent-dispatch-refusal.mjs";
import { createDispatchRunLifecycle } from "./workspace-agent-dispatch-run-lifecycle.mjs";
import {
  classifyReviewVerdictEligibility,
  deriveBackendReviewResult,
  isCleanupOnlyReviewerVerdict
} from "./workspace-agent-dispatch-review-result.mjs";
import {
  classifyExactSliceReviewVerdictEvidence,
  createExactSliceReviewReceipt,
  createExactSliceReviewReceiptStore,
  digestTrustedExactReviewEvidence,
  receiptCarriesUsableReviewVerdict
} from "./workspace-agent-dispatch-run-receipt.mjs";

import {
  STDIO_MCP_CLEANUP_BLOCKER_REASON,
  STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON
} from "./stdio-mcp-conduit-contract.mjs";
import { AGENT_LAUNCH_ROLE_CONFIG_FILENAME } from "./agent-launch-role-config.mjs";
import { defaultRunGit } from "./worktree-substrate.mjs";
import {
  COMMITTED_SLICE_REVIEW_ADMISSION_CODES,
  resolveCommittedSliceReviewAdmission
} from "./committed-slice-review-admission.mjs";
import {
  prepareReviewerDependencyProjection,
  verifyTerminalCandidateDependencies
} from "./terminal-wk-candidate-validation.mjs";
import { verifyTerminalWkCandidateObjectBinding } from "./terminal-wk-candidate.mjs";
import {
  integrateCommittedSlice,
  SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
  SLICE_INTEGRATION_POLICY_POSTURES
} from "./slice-integration.mjs";
import {
  assertTerminalCandidateMaterialization,
  verifyTerminalCandidateCheckout
} from "./terminal-review-materialization.mjs";
import {
  resolveUniqueManagedLifecycleBindingPairForRecovery
} from "./worktree-substrate-identity.mjs";

import {
  acquireManagedRunSubjectReservation,
  assessManagedRunProcessIdentity,
  attachTupleToManagedRunSubjectReservation,
  bindManagedRunSandboxProcessIdentity,
  deriveManagedRunIdentityTupleFromBindingPair,
  deriveOuterSandboxKillShape,
  discardManagedRunProcessIdentity,
  MANAGED_RUN_PROCESS_IDENTITY_RETIREMENT_REASONS,
  MANAGED_RUN_PROCESS_IDENTITY_VERDICTS,
  publishPendingManagedRunProcessIdentity,
  releaseManagedRunSubjectReservation,
  retireManagedRunAndReserveCorrectiveSuccessor,
  retireManagedRunProcessIdentity
} from "./managed-run-process-identity.mjs";
import {
  CORRECTIVE_CONTINUATION_PROOF_SCHEMA_VERSION
} from "./worktree-substrate-exact-unit.mjs";
import {
  WORKER_SCOPE_AUTHORITY_INVALID_BLOCKER,
  CALLER_SCOPE_CARRIERS,
  CALLER_MANAGED_LIFECYCLE_CARRIERS,
  CALLER_REVIEW_CONTEXT_CARRIERS,
  CONFIG_ATTEMPT_STATE_CARRIERS,
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
  resolveCanonicalSliceIntegrationUnit
} from "./backend-scope-authority.mjs";
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

export function createCanonicalCommittedSliceIntegrationAdapter(mainRepo) {
  const canonicalMainRepo = path.resolve(mainRepo ?? "");
  if (!path.isAbsolute(mainRepo ?? "") || canonicalMainRepo !== mainRepo) {
    throw new TypeError("canonical committed-slice integration requires a normalized absolute mainRepo");
  }
  return async ({ context, boundaryAuthorization } = {}) => {
    const target = boundaryAuthorization?.target;
    if (context?.review_admission_kind !== "canonical_committed_slice" ||
        target?.subject !== context.review_subject ||
        target?.committed_target_digest !== context.committed_target_digest ||
        target?.reviewed_sha !== context.reviewed_sha ||
        target?.diff_base_sha !== context.diff_base_sha ||
        target?.slice_ref !== context.slice_ref) {
      throw new Error("canonical committed-slice integration binding is unavailable or mismatched");
    }
    const writeStatus = ({ unitAddress, status, expectedSourceDigest }) =>
      setWorkRecordStatusByUnit({
        dir: canonicalMainRepo,
        unitAddress,
        status,
        expectedSourceDigest
      });
    return integrateCommittedSlice({
      mainRepo: canonicalMainRepo,
      worktreePath: context.worktree_path,
      unitAddress: `${context.initiative}/${context.record_id}/${context.review_slice_id}`,
      sliceRef: context.slice_ref,
      wkRef: `refs/heads/wk/${context.initiative}/${context.record_id}`,
      baseSha: context.diff_base_sha,
      commit: context.reviewed_sha,
      workerTerminated: false,
      transitionToReview: writeStatus,
      markSliceComplete: writeStatus,
      boundaryAuthorization
    });
  };
}

const CCE_BOUNDARY_POLICY_DECISION_SCHEMA_VERSION =
  "cce-boundary-policy-decision.v1";
const CCE_BOUNDARY_POLICY_REQUEST_SCHEMA_VERSION =
  "cce-boundary-policy-request.v1";
const CCE_POLICY_REFUSAL_SCHEMA_VERSION = "cce-policy-refusal.v1";
const CCE_POLICY_REFUSAL_CODES = Object.freeze({
  MISSING: "agent_launch.slice_integration.cce_policy_decision_missing.v1",
  UNAVAILABLE: "agent_launch.slice_integration.cce_policy_unavailable.v1",
  MALFORMED: "agent_launch.slice_integration.cce_policy_malformed.v1",
  UNRATIFIED: "agent_launch.slice_integration.cce_policy_unratified.v1",
  DENIED: "agent_launch.slice_integration.cce_policy_denied.v1",
  TARGET_MISMATCH: "agent_launch.slice_integration.cce_policy_target_mismatch.v1",
  DISPOSITION_INVALID: "agent_launch.slice_integration.advisory_disposition_invalid.v1"
});
const ORCHESTRATOR_ADVISORY_DISPOSITIONS = new Set(["accept", "reject", "defer"]);
const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const CCE_BOUNDARY_POLICY_DECISION_FIELDS = Object.freeze([
  "attestation_digest", "attestation_valid", "decision", "decision_id", "operation",
  "policy_id", "ratified", "schema_version", "target"
]);
const CCE_BOUNDARY_TARGET_FIELDS = Object.freeze([
  "committed_target_digest", "diff_base_sha", "initiative", "reviewed_sha",
  "slice_ref", "subject"
]);

function hasExactKeys(value, expected) {
  return isPlainObject(value) &&
    Object.keys(value).sort().join("|") === [...expected].sort().join("|");
}

function ccePolicyRefusal(code, reason, detail = null) {
  return Object.freeze({
    integrated: false,
    refused: true,
    refusal: Object.freeze({
      schema_version: CCE_POLICY_REFUSAL_SCHEMA_VERSION,
      code,
      reason,
      detail
    })
  });
}

function exactBoundaryTarget(context) {
  return Object.freeze({
    subject: context.review_subject,
    initiative: context.initiative,
    slice_ref: context.slice_ref,
    reviewed_sha: context.reviewed_sha,
    diff_base_sha: context.diff_base_sha,
    committed_target_digest: context.committed_target_digest
  });
}

function sameBoundaryTarget(left, right) {
  return left?.subject === right.subject &&
    left?.initiative === right.initiative &&
    left?.slice_ref === right.slice_ref &&
    left?.reviewed_sha === right.reviewed_sha &&
    left?.diff_base_sha === right.diff_base_sha &&
    left?.committed_target_digest === right.committed_target_digest;
}

function freeSubstrateBoundaryAuthorization(target) {
  return Object.freeze({
    schema_version: SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
    operation: "integrate_committed_slice",
    policy_posture: SLICE_INTEGRATION_POLICY_POSTURES.FREE_SUBSTRATE,
    policy_gate_configured: false,
    authority: "none",
    decision: "not_gated",
    ratified: false,
    attestation_valid: false,
    audit_grade: false,
    target
  });
}

function normalizeAdvisoryDispositions(dispositions, evidence) {
  if (dispositions === undefined) return Object.freeze([]);
  if (!Array.isArray(dispositions)) return null;
  const findingIdsByRun = new Map(evidence.reviews.map((review) => [
    review.run_id,
    new Set((review.findings ?? []).map((finding) => finding.id))
  ]));
  const normalized = [];
  const seen = new Set();
  for (const entry of dispositions) {
    const keys = isPlainObject(entry) ? Object.keys(entry).sort() : [];
    if (keys.join("|") !== "disposition|finding_id|review_run_id" ||
        typeof entry.review_run_id !== "string" ||
        typeof entry.finding_id !== "string" ||
        !ORCHESTRATOR_ADVISORY_DISPOSITIONS.has(entry.disposition) ||
        !findingIdsByRun.get(entry.review_run_id)?.has(entry.finding_id)) {
      return null;
    }
    const key = `${entry.review_run_id}\u0000${entry.finding_id}`;
    if (seen.has(key)) return null;
    seen.add(key);
    normalized.push(Object.freeze({
      review_run_id: entry.review_run_id,
      finding_id: entry.finding_id,
      disposition: entry.disposition
    }));
  }
  return Object.freeze(normalized);
}

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

    proveAssignedSourceReadable = null
  } = options;
  const correctiveContinuationProofs = new Map();
  const normalizedWorktreeProvisioningConfig = normalizeProvisioningConfig(options.worktreeProvisioning);

  const worktreeProvisioningConfig = normalizedWorktreeProvisioningConfig === null
    ? null
    : {
        ...normalizedWorktreeProvisioningConfig,
        deps: {
          ...(normalizedWorktreeProvisioningConfig.deps ?? {}),
          resolveCorrectiveContinuationProof({
            subject,
            unit_address: unitAddress,
            slice_ref: sliceRef,
            slice_tip: sliceTip,
            worktree_path: worktreePath
          } = {}) {
            const retained = correctiveContinuationProofs.get(subject) ?? null;
            const proof = retained?.proof ?? null;
            if (proof === null || proof.unit_address !== unitAddress ||
                proof.slice_ref !== sliceRef || proof.delivered_tip_sha !== sliceTip ||
                proof.worktree_path !== worktreePath) return null;
            correctiveContinuationProofs.delete(subject);
            return proof;
          }
        }
      };

  const requireManagedProvisioning = options.requireManagedProvisioning === true;
  const attemptStateAuthority = createLauncherOwnedManagedAttemptStateAuthority();
  const registeredWorkerScopeSnapshots = new WeakSet();
  const frozenReviewContextsByTarget = new Map();
  const currentReviewTargetBySubject = new Map();
  const currentTerminalReviewTargetByWk = new Map();
  const wholeReviewRunContexts = new Map();
  const terminalCandidateRecoveryInFlight = new Map();
  const recoverTerminalCandidate = typeof options.recoverTerminalCandidate === "function"
    ? options.recoverTerminalCandidate
    : null;
  const wholeReviewTargetKey = (context) => JSON.stringify([
    context.review_subject,
    context.candidate_sha ?? context.wk_sha,
    context.landing_sha ?? context.diff_base_sha,
    context.canonical_wk_digest ?? null
  ]);
  const frozenReviewContexts = Object.freeze({
    get(subject) {
      const key = currentReviewTargetBySubject.get(subject);
      return key === undefined ? undefined : frozenReviewContextsByTarget.get(key);
    },
    set(subject, context) {
      const key = wholeReviewTargetKey(context);
      frozenReviewContextsByTarget.set(key, context);
      currentReviewTargetBySubject.set(subject, key);
      if (context.review_identity_kind === "terminal_candidate" &&
          typeof context.record_id === "string") {
        currentTerminalReviewTargetByWk.set(context.record_id, key);
      }
      return this;
    },
    has(subject) { return this.get(subject) !== undefined; },
    values() { return frozenReviewContextsByTarget.values(); }
  });

  const frozenSliceReviewContextsByTarget = new Map();
  const currentSliceReviewTargetBySubject = new Map();
  const sliceReviewRunContexts = new Map();
  const canonicalCommittedSliceIntegrations = new Map();
  const canonicalCommittedSliceIntegrationAttempts = new Map();

  const sliceIntegrationCcePolicy = options.sliceIntegrationCcePolicy ?? null;
  const sliceReviewTargetKey = (context) => JSON.stringify([
    context.review_subject,
    context.reviewed_sha,
    context.diff_base_sha,
    context.committed_target_digest ?? context.worktree_identity_digest
  ]);
  const committedSliceIntegrationTargetKey = (context) => JSON.stringify([
    context.review_subject,
    context.slice_ref,
    context.reviewed_sha,
    context.diff_base_sha,
    context.committed_target_digest
  ]);
  const frozenSliceReviewContexts = Object.freeze({
    get(subject) {
      const key = currentSliceReviewTargetBySubject.get(subject);
      return key === undefined ? undefined : frozenSliceReviewContextsByTarget.get(key);
    },
    set(subject, context) {
      const key = sliceReviewTargetKey(context);
      frozenSliceReviewContextsByTarget.set(key, context);
      currentSliceReviewTargetBySubject.set(subject, key);
      return this;
    },
    has(subject) {
      return this.get(subject) !== undefined;
    },
    values() {
      return frozenSliceReviewContextsByTarget.values();
    }
  });
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
  const canonicalCommittedSliceIntegration =
    typeof options.canonicalCommittedSliceIntegration === "function"
      ? options.canonicalCommittedSliceIntegration
      : worktreeProvisioningConfig?.mainRepo
        ? createCanonicalCommittedSliceIntegrationAdapter(worktreeProvisioningConfig.mainRepo)
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

  function structuredReceiptOutcome(record) {
    const evidence = record?.final_result?.structured_role_result;
    if (evidence?.valid !== true || evidence?.claims?.reported_role !== record.role ||
        !new Set(["reviewer", "redteam"]).has(record.role) ||
        evidence?.claims?.reported_subject !== record.subject) return null;

    if (classifyReviewVerdictEligibility(record) === null) return null;

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
    if (result.reported_role !== record.role || result.reported_subject !== record.subject ||
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

  function validatedReviewerVerdictPresent(record) {
    const evidence = record?.final_result?.structured_role_result;
    return evidence?.valid === true &&
      evidence?.claims?.reported_role === record?.role &&
      new Set(["reviewer", "redteam"]).has(record?.role) &&
      evidence?.claims?.reported_subject === record?.subject;
  }

  const LAUNCH_TRANSPORT_FAILURE_REASONS = new Set([
    STDIO_MCP_CLIENT_READINESS_BLOCKER_REASON,
    STDIO_MCP_CLEANUP_BLOCKER_REASON
  ]);
  function launchTransportFailedRun(record) {
    if (record?.terminal !== true) return false;
    const reason = record?.final_result?.missing_result?.reason ?? null;
    return typeof reason === "string" && LAUNCH_TRANSPORT_FAILURE_REASONS.has(reason);
  }

  async function persistExactSliceReviewReceipt(context, record) {
    if (exactSliceReviewReceiptStore === null) return null;
    const structuredOutcome = structuredReceiptOutcome(record);
    const receipt = createExactSliceReviewReceipt({
      unit_address: context.review_subject,
      record_id: context.record_id,
      slice_id: context.review_slice_id,
      initiative: context.initiative,
      canonical_parent_wk_contract: context.canonical_parent_wk_contract,
      canonical_parent_contract_digest:
        digestTrustedExactReviewEvidence(context.canonical_parent_wk_contract),
      slice_review_contract: context.review_unit_contract,
      slice_review_contract_digest:
        digestTrustedExactReviewEvidence(context.review_unit_contract),
      ...(context.review_admission_kind === "canonical_committed_slice"
        ? {
            review_admission_kind: context.review_admission_kind,
            committed_target_digest: context.committed_target_digest
          }
        : {
            source_worker_run_id: context.source_worker_run_id,
            source_worker_monitor_handle: context.source_worker_monitor_handle
          }),
      review_run_id: record.run_id,
      review_monitor_handle: record.monitor_handle,
      reviewer_role: record.role,
      slice_ref: context.slice_ref,
      worktree_path: context.worktree_path,
      worktree_identity: context.worktree_identity,
      worktree_identity_digest: context.worktree_identity_digest,
      reviewed_sha: context.reviewed_sha,
      diff_base_sha: context.diff_base_sha,
      terminal_run_status: record.status,
      structured_outcome: structuredOutcome,

      ...(isCleanupOnlyReviewerVerdict(record) ? { cleanup_only_terminal_failure: true } : {}),

      verdict_evidence: classifyExactSliceReviewVerdictEvidence({
        terminal_run_status: record.status,
        structured_outcome: structuredOutcome,

        validated_verdict_present: validatedReviewerVerdictPresent(record),
        launch_transport_failed: launchTransportFailedRun(record)
      })
    });
    return exactSliceReviewReceiptStore.persist(receipt);
  }

  async function captureSliceReviewTerminalResult({ record }) {
    const context = sliceReviewRunContexts.get(record?.run_id) ?? null;
    if (context !== null && context.slice_level_review === true &&
        (record.role === "reviewer" || record.role === "redteam")) {
      return persistExactSliceReviewReceipt(context, record);
    }
    const terminalContext = wholeReviewRunContexts.get(record?.run_id) ?? null;
    if (terminalContext?.review_identity_kind !== "terminal_candidate" ||
        (record?.role !== "reviewer" && record?.role !== "redteam")) return null;
    assertRetainedReviewerLaunchIdentityMatchesContext(record.reviewer_launch_identity, terminalContext);
    verifyTerminalReviewContext(terminalContext);
    return null;
  }

  async function resolveSliceIntegrationBoundaryAuthorization({
    context,
    evidence,
    orchestratorDispositions
  }) {
    const target = exactBoundaryTarget(context);
    if (sliceIntegrationCcePolicy === null || sliceIntegrationCcePolicy?.configured === false) {
      return { ok: true, authorization: freeSubstrateBoundaryAuthorization(target) };
    }
    if (!isPlainObject(sliceIntegrationCcePolicy) ||
        sliceIntegrationCcePolicy.configured !== true) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.MALFORMED,
          "committed-slice CCE policy gate configuration is malformed"
        )
      };
    }
    if (typeof sliceIntegrationCcePolicy.authorize !== "function") {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.MISSING,
          "configured CCE policy gate has no authorization resolver"
        )
      };
    }
    let decision;
    try {
      decision = await sliceIntegrationCcePolicy.authorize(Object.freeze({
        schema_version: CCE_BOUNDARY_POLICY_REQUEST_SCHEMA_VERSION,
        operation: "integrate_committed_slice",
        target,
        advisory_review_evidence: evidence,
        orchestrator_dispositions: orchestratorDispositions
      }));
    } catch (error) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.UNAVAILABLE,
          "configured CCE policy authorization is unavailable",
          { diagnostic_code: typeof error?.code === "string" ? error.code : null }
        )
      };
    }
    if (decision === null || decision === undefined) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.MISSING,
          "configured CCE policy returned no decision"
        )
      };
    }
    if (!hasExactKeys(decision, CCE_BOUNDARY_POLICY_DECISION_FIELDS) ||
        decision.schema_version !== CCE_BOUNDARY_POLICY_DECISION_SCHEMA_VERSION ||
        decision.operation !== "integrate_committed_slice" ||
        !new Set(["allow", "deny"]).has(decision.decision) ||
        typeof decision.policy_id !== "string" || decision.policy_id.length === 0 ||
        typeof decision.decision_id !== "string" || decision.decision_id.length === 0 ||
        !SHA256_DIGEST_RE.test(decision.attestation_digest ?? "") ||
        typeof decision.ratified !== "boolean" ||
        typeof decision.attestation_valid !== "boolean" ||
        !hasExactKeys(decision.target, CCE_BOUNDARY_TARGET_FIELDS)) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.MALFORMED,
          "configured CCE policy returned a malformed decision"
        )
      };
    }
    if (!sameBoundaryTarget(decision.target, target)) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.TARGET_MISMATCH,
          "configured CCE policy decision is bound to a different exact target"
        )
      };
    }
    if (decision.ratified !== true || decision.attestation_valid !== true) {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.UNRATIFIED,
          "configured CCE policy decision is unratified or has invalid attestation"
        )
      };
    }
    if (decision.decision !== "allow") {
      return {
        ok: false,
        refusal: ccePolicyRefusal(
          CCE_POLICY_REFUSAL_CODES.DENIED,
          "configured CCE policy denied committed-slice integration",
          { policy_id: decision.policy_id, decision_id: decision.decision_id }
        )
      };
    }
    return {
      ok: true,
      authorization: Object.freeze({
        schema_version: SLICE_INTEGRATION_BOUNDARY_AUTHORIZATION_SCHEMA_VERSION,
        operation: "integrate_committed_slice",
        policy_posture: SLICE_INTEGRATION_POLICY_POSTURES.CCE_POLICY,
        policy_gate_configured: true,
        authority: "cce",
        decision: "allow",
        ratified: true,
        attestation_valid: true,
        audit_grade: true,
        policy_id: decision.policy_id,
        decision_id: decision.decision_id,
        attestation_digest: decision.attestation_digest,
        target
      })
    };
  }

  function emptySliceReviewAdvisoryEvidence(context, observationDiagnostic = null) {
    return Object.freeze({
      schema_version: "workspace-agent-slice-review-advisory-evidence.v1",
      unit_address: context.review_subject,
      initiative: context.initiative,
      slice_ref: context.slice_ref,
      reviewed_sha: context.reviewed_sha,
      diff_base_sha: context.diff_base_sha,
      review_admission_kind: context.review_admission_kind,
      committed_target_digest: context.committed_target_digest,
      active_review_run_ids: Object.freeze([]),
      clean_review_run_ids: Object.freeze([]),
      findings_review_run_ids: Object.freeze([]),
      invalid_review_run_ids: Object.freeze([]),
      reviews: Object.freeze([]),
      observation_complete: false,
      observation_diagnostic: observationDiagnostic,
      authority: "advisory_only"
    });
  }

  async function requestCommittedSliceIntegration({ subject, dispositions } = {}) {
    if (worktreeProvisioningConfig === null ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "")) {
      return Object.freeze({
        integrated: false,
        reason: "canonical_committed_slice_integration_unavailable",
        code: COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED
      });
    }
    let context;
    try {
      const integrationUnit = resolveCanonicalSliceIntegrationUnit(
        worktreeProvisioningConfig.mainRepo,
        subject
      );
      const admission = resolveCommittedSliceReviewAdmission({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
        subject,
        reviewUnit: integrationUnit,
        requireWorktree: false,
        runGit: reviewContextRunGit
      });
      context = Object.freeze({
        schema_version: "workspace-agent-committed-slice-integration-context.v1",
        review_admission_kind: admission.review_admission_kind,
        empty_delivery: admission.empty_delivery === true,
        committed_target_digest: admission.committed_target_digest,
        review_subject: subject,
        record_id: integrationUnit.record_id,
        review_slice_id: integrationUnit.slice_id,
        initiative: integrationUnit.initiative,
        canonical_parent_wk_contract: integrationUnit.canonical_parent_wk_contract,
        review_unit_contract: integrationUnit.review_unit_contract,
        main_repo: worktreeProvisioningConfig.mainRepo,
        worktree_path: admission.worktree_path,
        slice_ref: admission.target.ref,
        reviewed_sha: admission.target.sha,
        diff_base_sha: admission.target.diff_base_sha,
        diff_head_sha: admission.target.sha,
        diff_range: admission.target.diff_range,
        worktree_identity: admission.identity
      });
    } catch (error) {
      return Object.freeze({
        integrated: false,
        reason: error?.detail?.reason ?? "canonical_committed_slice_integration_unavailable",
        code: error?.code ?? COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED
      });
    }
    const reviewContext = frozenSliceReviewContexts.get(subject) ?? null;
    let observedEvidence = null;
    let observationDiagnostic = null;
    if (reviewContext !== null &&
        reviewContext.slice_ref === context.slice_ref &&
        reviewContext.reviewed_sha === context.reviewed_sha &&
        reviewContext.diff_base_sha === context.diff_base_sha) {
      try {
        observedEvidence = await resolveSliceReviewEvidenceSet({ subject });
      } catch (error) {

        observationDiagnostic = Object.freeze({
          code: "review_evidence_observation_unavailable",
          source_code: typeof error?.code === "string" ? error.code : null
        });
      }
    }
    const evidence = observedEvidence?.schema_version ===
        "workspace-agent-slice-review-advisory-evidence.v1"
      ? observedEvidence
      : emptySliceReviewAdvisoryEvidence(context, observationDiagnostic);
    const orchestratorDispositions = normalizeAdvisoryDispositions(dispositions, evidence);
    if (orchestratorDispositions === null) {
      return ccePolicyRefusal(
        CCE_POLICY_REFUSAL_CODES.DISPOSITION_INVALID,
        "orchestrator advisory dispositions do not match retained exact-target findings"
      );
    }
    if (canonicalCommittedSliceIntegration === null) {
      throw new Error("canonical committed-slice integration adapter is unavailable");
    }
    const key = committedSliceIntegrationTargetKey(context);
    if (canonicalCommittedSliceIntegrations.has(key)) {
      return canonicalCommittedSliceIntegrations.get(key);
    }
    if (!canonicalCommittedSliceIntegrationAttempts.has(key)) {
      const attempt = (async () => {
        const policy = await resolveSliceIntegrationBoundaryAuthorization({
          context,
          evidence,
          orchestratorDispositions
        });
        if (policy.ok !== true) return policy.refusal;
        const integration = await canonicalCommittedSliceIntegration({
          context,
          boundaryAuthorization: policy.authorization
        });
        const result = Object.freeze({
          ...integration,
          advisory_review_evidence: evidence,
          orchestrator_dispositions: orchestratorDispositions
        });
        canonicalCommittedSliceIntegrations.set(key, Promise.resolve(result));
        return result;
      })();
      canonicalCommittedSliceIntegrationAttempts.set(key, attempt);
    }
    try {
      return await canonicalCommittedSliceIntegrationAttempts.get(key);
    } finally {
      canonicalCommittedSliceIntegrationAttempts.delete(key);
    }
  }

  async function resolveCommittedSliceIntegrationContinuation({ subject } = {}) {
    const context = frozenSliceReviewContexts.get(subject) ?? null;
    if (context === null) return null;
    const completed = canonicalCommittedSliceIntegrations.get(
      committedSliceIntegrationTargetKey(context)
    );
    if (completed === undefined) return null;
    const integration = await completed;
    return Object.freeze({
      requested: true,
      completed: integration?.integrated === true,
      reviewed_sha: context.reviewed_sha
    });
  }

  async function resolveCorrectiveFindingsContext({ subject, workspace_dir: workspaceDir }) {
    if (exactSliceReviewReceiptStore === null ||
        path.resolve(workspaceDir ?? "") !== worktreeProvisioningConfig?.mainRepo ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "")) return null;
    const targetContext = frozenSliceReviewContexts.get(subject) ?? null;
    if (targetContext === null) return null;
    const receipts = await exactSliceReviewReceiptStore.loadAll({
      unit_address: subject,
      committed_target_digest: targetContext.committed_target_digest
    });
    const findingsReceipts = receipts.filter((receipt) =>
      receiptCarriesUsableReviewVerdict(receipt) &&
      receipt.structured_outcome?.outcome === "changes_requested"
    );
    if (findingsReceipts.length === 0) return null;
    const receipt = findingsReceipts[0];
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
      source_worker_run_id: targetContext.source_worker_run_id ?? null,
      source_worker_monitor_handle: targetContext.source_worker_monitor_handle ?? null,
      review_run_ids: findingsReceipts.map((entry) => entry.review_run_id),
      review_monitor_handles: findingsReceipts.map((entry) => entry.review_monitor_handle),
      reviewed_sha: receipt.reviewed_sha,
      diff_base_sha: receipt.diff_base_sha,
      findings: findingsReceipts.flatMap((entry) => entry.structured_outcome.findings),
      trusted_evidence_digests: findingsReceipts.map((entry) => entry.trusted_evidence_digest)
    });
  }

  const managedWorkerIdentityRequired = requireManagedProvisioning;
  const managedRunIdentityRoot = requireManagedProvisioning
    ? (worktreeProvisioningConfig?.mainRepo ?? null)
    : null;

  const managedRunIdentityDeps = options.managedRunProcessIdentityDeps ?? undefined;

  const managedRunIdentityTuple = ({ subject, run_id, monitor_handle }) => ({
    assigned_unit: subject,
    launch_ref: monitor_handle,
    run_id,
    retry_id: 0
  });

  function resolveMechanicallyAuthenticatedCorrectiveContinuation(subject) {
    if (worktreeProvisioningConfig === null ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject ?? "")) return null;
    try {
      const reviewUnit = resolveCanonicalSliceReviewUnit(
        worktreeProvisioningConfig.mainRepo,
        subject
      );
      const admission = resolveCommittedSliceReviewAdmission({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
        subject,
        reviewUnit,
        runGit: reviewContextRunGit
      });
      const identity = admission.identity;
      return deepFreezeCanonicalSnapshot({
        schema_version: CORRECTIVE_CONTINUATION_PROOF_SCHEMA_VERSION,
        subject,
        unit_address: `${identity.initiative}/${identity.record_id}/${identity.slice_id}`,
        slice_ref: identity.slice_ref,
        frozen_base_sha: identity.diff_base_sha,
        delivered_tip_sha: identity.reviewed_sha,
        commit_chain: identity.commit_chain,
        committed_target_digest: identity.committed_target_digest,
        worktree_path: identity.worktree_path
      });
    } catch {
      return null;
    }
  }

  function retainCorrectiveContinuationProof(subject, reservation, proof) {
    if (reservation === null || proof === null) return;
    correctiveContinuationProofs.set(subject, Object.freeze({
      reservation_id: reservation.reservation_id,
      proof
    }));
  }

  async function supersedeProvenDeadAttemptForCorrectiveWorker({ subject, priorAttempt }) {
    if (managedRunIdentityRoot === null ||
        priorAttempt?.verdict !== MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD ||
        !priorAttempt.tuple) {
      return null;
    }
    const proof = resolveMechanicallyAuthenticatedCorrectiveContinuation(subject);
    if (proof === null) return null;
    const successor = retireManagedRunAndReserveCorrectiveSuccessor({
      mainRepo: managedRunIdentityRoot,
      tuple: priorAttempt.tuple,
      subject,
      role: "worker",
      evidence: {
        source_worker_run_id: priorAttempt.tuple.run_id,
        source_worker_monitor_handle: priorAttempt.tuple.launch_ref,
        subject,
        slice_ref: proof.slice_ref,
        frozen_base_sha: proof.frozen_base_sha,
        delivered_tip_sha: proof.delivered_tip_sha,
        commit_chain: proof.commit_chain,
        committed_target_digest: proof.committed_target_digest
      },
      ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
    });
    if (successor.may_launch === true) {
      retainCorrectiveContinuationProof(subject, successor.reservation, proof);
    }
    return successor;
  }

  const checkPriorManagedAttempt = managedRunIdentityRoot === null
    ? null
    : async ({ role, subject }) => {
        const acquire = () => acquireManagedRunSubjectReservation({
          mainRepo: managedRunIdentityRoot,
          subject,
          role,
          ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
        });
        const first = acquire();
        if (first.may_launch === true) {
          retainCorrectiveContinuationProof(
            subject,
            first.reservation,
            resolveMechanicallyAuthenticatedCorrectiveContinuation(subject)
          );
          return first;
        }
        const successor = await supersedeProvenDeadAttemptForCorrectiveWorker({
          subject,
          priorAttempt: first
        });
        return successor ?? first;
      };

  const releaseManagedRunSubjectReservationForLaunch = managedRunIdentityRoot === null
    ? null
    : (reservation) => {
        const retained = correctiveContinuationProofs.get(reservation?.subject) ?? null;
        if (retained?.reservation_id === reservation?.reservation_id) {
          correctiveContinuationProofs.delete(reservation.subject);
        }
        return releaseManagedRunSubjectReservation({
          mainRepo: managedRunIdentityRoot,
          subject: reservation?.subject,
          reservationId: reservation?.reservation_id ?? null
        });
      };

  const publishPendingManagedRunIdentity = managedRunIdentityRoot === null
    ? null
    : ({ role, subject, run_id, monitor_handle, reservation = null }) => {
        const tuple = managedRunIdentityTuple({ subject, run_id, monitor_handle });
        const pending = publishPendingManagedRunProcessIdentity({
          mainRepo: managedRunIdentityRoot,
          tuple,
          role,
          ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
        });

        if (reservation !== null) {
          attachTupleToManagedRunSubjectReservation({
            mainRepo: managedRunIdentityRoot,
            reservation,
            tuple
          });
        }
        return Object.freeze({
          tuple,
          bind: ({ pid, enforcement }) => bindManagedRunSandboxProcessIdentity(pending, {
            pid,
            killShape: deriveOuterSandboxKillShape({ pid, enforcement }),
            ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
          }),
          discard: () => discardManagedRunProcessIdentity({ mainRepo: managedRunIdentityRoot, tuple })
        });
      };

  const bindManagedRunOuterIdentity = managedRunIdentityRoot === null
    ? null
    : (pending, { pid, enforcement }) => pending.bind({ pid, enforcement });

  const resolveManagedWorkerProvenDeath = ({ assigned_unit, launch_ref, run_id, retry_id }) => {
    if (managedRunIdentityRoot === null) {
      return Object.freeze({
        proven_dead: false,
        verdict: MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.ABSENT,
        reason: "this backend composes no durable managed-run identity store"
      });
    }
    const assessed = assessManagedRunProcessIdentity({
      mainRepo: managedRunIdentityRoot,
      tuple: { assigned_unit, launch_ref, run_id, retry_id },
      ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
    });
    return Object.freeze({
      ...assessed,
      proven_dead: assessed.verdict === MANAGED_RUN_PROCESS_IDENTITY_VERDICTS.PROVEN_DEAD
    });
  };

  const retireManagedWorkerIdentity = ({ assigned_unit, launch_ref, run_id, retry_id, reason, evidence }) => {
    if (managedRunIdentityRoot === null) {
      return Object.freeze({ retired: false, reason: "no durable managed-run identity store" });
    }
    const tuple = { assigned_unit, launch_ref, run_id, retry_id };
    let outcome;
    try {
      outcome = retireManagedRunProcessIdentity({
        mainRepo: managedRunIdentityRoot,
        tuple,
        reason,
        evidence,
        ...(managedRunIdentityDeps ? { deps: managedRunIdentityDeps } : {})
      });
    } catch (error) {

      return Object.freeze({
        retired: false,
        reason: error?.message ?? String(error),
        code: error?.code ?? null
      });
    }
    if (outcome.retired === true) {
      releaseManagedRunSubjectReservation({
        mainRepo: managedRunIdentityRoot,
        subject: assigned_unit,
        tuple
      });
    }
    return outcome;
  };

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
    freezeWorkerScopeSnapshot,
    validateWorkerScopeSnapshot,
    deriveReviewerLaunchIdentity,
    proveAssignedSourceReadable,
    captureSliceReviewTerminalResult
    ,resolveCorrectiveFindingsContext,

    managedWorkerIdentityRequired,
    managedRunIdentityRootPresent: managedRunIdentityRoot !== null,
    checkPriorManagedAttempt,
    publishPendingManagedRunIdentity,
    bindManagedRunOuterIdentity,
    releaseManagedRunSubjectReservationForLaunch
  });

  function resolveManagedRunBinding(status) {
    return attemptStateAuthority.resolveProvisioningBinding(status);
  }

  function sameTerminalReviewAddress(left, right) {
    return left?.subject === (right?.subject ?? right?.review_subject) &&
      left?.record_id === right?.record_id &&
      left?.slice_id === (right?.slice_id ?? right?.review_slice_id);
  }

  function terminalCandidateReviewTarget(terminalCandidate) {
    const binding = terminalCandidate?.binding;
    const materialization = terminalCandidate?.materialization;
    return Object.freeze({
      schema_version: "agent_launch.terminal_candidate_review_target.v1",
      review_identity_kind: "terminal_candidate",
      ref: binding?.candidate_ref,
      sha: binding?.candidate,
      candidate_ref: binding?.candidate_ref,
      candidate_sha: binding?.candidate,
      landing_ref: binding?.landing_ref,
      landing_sha: binding?.landing_tip,
      wk_ref: binding?.wk_ref,
      wk_sha: binding?.wk_tip,
      worktree_path: materialization?.checkout_path,
      canonical_wk_digest: binding?.canonical_wk_digest,
      diff_base_sha: binding?.landing_tip,
      diff_head_sha: binding?.candidate,
      diff_range: `${binding?.landing_tip}..${binding?.candidate}`,
      complete_parent_wk_contract: true,
      accumulated_wk_diff: true
    });
  }

  function bindFrozenReviewContext({
    status,
    provisioning,
    integration,
    reviewUnit,
    terminalCandidate = null,
    terminalCandidateValidations = null,
    recoveredTerminalCandidate = false
  }) {
    const target = assertFrozenReviewTarget(integration?.review_target);
    const wkBinding = provisioning?.wk_binding;
    const terminalCandidateReview = target.review_identity_kind === "terminal_candidate";
    const boundReviewUnit = terminalCandidateReview && terminalCandidate?.review_unit
      ? terminalCandidate.review_unit
      : reviewUnit;
    const worktreePath = terminalCandidateReview ? target.worktree_path : provisioning?.validation_worktree_path;
    const expectedWkRef = wkBinding?.output_branch?.startsWith("refs/heads/")
      ? wkBinding.output_branch
      : `refs/heads/${wkBinding?.output_branch ?? ""}`;
    const managedLifecycleMismatch = recoveredTerminalCandidate !== true && (
      (terminalCandidateReview ? expectedWkRef !== target.wk_ref : expectedWkRef !== target.ref) ||
      (!terminalCandidateReview && worktreePath !== wkBinding?.worktree_path) ||
      provisioning?.record_id !== reviewUnit?.record_id ||
      status?.subject !== `${reviewUnit?.record_id}#${provisioning?.slice_id}`
    );
    if (!isPlainObject(boundReviewUnit) || typeof boundReviewUnit.subject !== "string" ||
        typeof boundReviewUnit.canonical_parent_wk_contract !== "string" ||
        typeof boundReviewUnit.review_unit_contract !== "string" ||
        (!terminalCandidateReview && reviewUnit.parent_status !== "review") ||
        typeof boundReviewUnit?.initiative !== "string" || !/^IN-\d{4}$/u.test(boundReviewUnit.initiative) ||
        (terminalCandidateReview
          ? target.wk_ref !== `refs/heads/wk/${boundReviewUnit.initiative}/${boundReviewUnit.record_id}` ||
            terminalCandidate === null
          : target.ref !== `refs/heads/wk/${reviewUnit.initiative}/${reviewUnit.record_id}` ||
            terminalCandidate !== null) ||
        !path.isAbsolute(worktreePath ?? "") ||
        managedLifecycleMismatch ||
        (recoveredTerminalCandidate === true && !terminalCandidateReview)) {
      throw new Error("backend-owned frozen review context does not match managed provisioning and canonical review identity");
    }
    if (terminalCandidateReview && !sameTerminalReviewAddress(reviewUnit, boundReviewUnit)) {
      throw new Error("terminal-candidate review address disagrees with the selected terminal review unit");
    }
    if (terminalCandidateReview) {
      if (!isPlainObject(terminalCandidate.dependency_proof) ||
          !Array.isArray(terminalCandidate.dependency_proof.reviewer_read_only_binds) ||
          terminalCandidate.dependency_proof.reviewer_read_only_binds.length === 0) {
        throw new Error("terminal-candidate reviewer dependency projection proof is absent or incomplete");
      }
      assertTerminalCandidateMaterialization(terminalCandidate.materialization, terminalCandidate.binding);
      const targetFields = [
        ["candidate_ref", terminalCandidate.binding.candidate_ref],
        ["candidate_sha", terminalCandidate.binding.candidate],
        ["landing_ref", terminalCandidate.binding.landing_ref],
        ["landing_sha", terminalCandidate.binding.landing_tip],
        ["wk_ref", terminalCandidate.binding.wk_ref],
        ["wk_sha", terminalCandidate.binding.wk_tip],
        ["canonical_wk_digest", terminalCandidate.binding.canonical_wk_digest],
        ["worktree_path", terminalCandidate.materialization.checkout_path]
      ];
      const mismatch = targetFields.find(([field, expected]) => target[field] !== expected);
      if (mismatch) throw new Error(`terminal-candidate backend binding disagrees at ${mismatch[0]}`);
      verifyTerminalCandidateCheckout({
        binding: terminalCandidate.binding,
        candidateRoot: terminalCandidate.materialization.candidate_root,
        runGit: reviewContextRunGit
      });
    }

    if (frozenSliceReviewContexts.has(reviewUnit.subject)) {
      throw new Error("subject already bound to a slice-level review context; a whole-WK review context cannot coexist");
    }
    const existing = frozenReviewContexts.get(reviewUnit.subject) ?? null;
    if (existing !== null) {
      const sameTarget = terminalCandidateReview
        ? existing.candidate_sha === target.candidate_sha &&
          existing.landing_sha === target.landing_sha &&
          existing.terminal_candidate_dependency_proof?.digest === terminalCandidate.dependency_proof?.digest &&
          sameTerminalReviewAddress(boundReviewUnit, existing)
        : existing.wk_sha === target.sha && existing.diff_base_sha === target.diff_base_sha;
      if (sameTarget) return existing;
    }
    const trustedFrozenReviewContract = createTrustedFrozenReviewContract(boundReviewUnit);
    const context = Object.freeze({
      schema_version: "workspace-agent-frozen-wk-review-context.v1",
      review_subject: boundReviewUnit.subject,
      record_id: boundReviewUnit.record_id,
      review_slice_id: boundReviewUnit.slice_id,
      initiative: boundReviewUnit.initiative,
      canonical_parent_wk_contract: boundReviewUnit.canonical_parent_wk_contract,
      review_unit_contract: boundReviewUnit.review_unit_contract,
      trusted_frozen_review_contract: trustedFrozenReviewContract,
      main_repo: worktreeProvisioningConfig.mainRepo,
      worktree_path: worktreePath,
      wk_ref: terminalCandidateReview ? target.wk_ref : target.ref,
      wk_sha: terminalCandidateReview ? target.wk_sha : target.sha,
      ...(terminalCandidateReview ? {
        review_identity_kind: "terminal_candidate",
        candidate_ref: target.candidate_ref,
        candidate_sha: target.candidate_sha,
        landing_ref: target.landing_ref,
        landing_sha: target.landing_sha,
        canonical_wk_digest: target.canonical_wk_digest,
        terminal_candidate_binding: terminalCandidate.binding,
        terminal_candidate_materialization: terminalCandidate.materialization,
        terminal_candidate_dependency_proof: terminalCandidate.dependency_proof ?? null,
        reviewer_dependency_binds: Object.freeze([
          ...(terminalCandidate.dependency_proof?.reviewer_read_only_binds ?? [])
        ]),
        reviewer_validation_evidence: Object.freeze([
          ...(Array.isArray(terminalCandidateValidations)
            ? terminalCandidateValidations
            : Array.isArray(terminalCandidate.validation_evidence)
              ? terminalCandidate.validation_evidence
              : [])
        ])
      } : {}),
      diff_base_sha: target.diff_base_sha,
      diff_head_sha: target.diff_head_sha,
      diff_range: target.diff_range,
      complete_parent_wk_contract: true,
      accumulated_wk_diff: true,
      source_worker_run_id: status?.run_id ?? null,
      source_worker_subject: status?.subject ?? null,
      review_evidence_semantics: "append_only_advisory"
    });
    frozenReviewContexts.set(reviewUnit.subject, context);
    return context;
  }

  function verifyTerminalReviewContext(context) {
    verifyTerminalWkCandidateObjectBinding({
      binding: context.terminal_candidate_binding,
      runGit: reviewContextRunGit
    });
    verifyTerminalCandidateCheckout({
      binding: context.terminal_candidate_binding,
      candidateRoot: context.terminal_candidate_materialization.candidate_root,
      runGit: reviewContextRunGit
    });
    const dependencyProof = verifyTerminalCandidateDependencies({
      binding: context.terminal_candidate_binding,
      materialization: context.terminal_candidate_materialization
    });
    if (dependencyProof.digest !== context.terminal_candidate_dependency_proof?.digest) {
      throw new Error("terminal-candidate dependency projection changed after the review context was frozen");
    }
    return context;
  }

  async function recoverTerminalReviewContext(reviewAddress) {
    if (recoverTerminalCandidate === null || worktreeProvisioningConfig === null) {
      return {
        ok: false,
        refusal: managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
          capability: "wk_context_review",
          reason: "terminal_candidate_recovery_unavailable",
          subject: reviewAddress.subject
        })
      };
    }
    let recovery = terminalCandidateRecoveryInFlight.get(reviewAddress.subject) ?? null;
    if (recovery === null) {
      recovery = (async () => {
        const terminalCandidate = await recoverTerminalCandidate(reviewAddress.record_id);
        if (!isPlainObject(terminalCandidate) || !isPlainObject(terminalCandidate.review_unit) ||
            terminalCandidate.review_unit.subject !== reviewAddress.subject ||
            terminalCandidate.review_unit.record_id !== reviewAddress.record_id) {
          const error = new Error("recovered terminal candidate does not bind the canonical selected review unit");
          error.code = "terminal_candidate_recovery_review_subject_mismatch";
          throw error;
        }
        return bindFrozenReviewContext({
          status: null,
          provisioning: null,
          integration: { review_target: terminalCandidateReviewTarget(terminalCandidate) },
          reviewUnit: terminalCandidate.review_unit,
          terminalCandidate,
          terminalCandidateValidations: terminalCandidate.validation_evidence,
          recoveredTerminalCandidate: true
        });
      })();
      terminalCandidateRecoveryInFlight.set(reviewAddress.subject, recovery);
    }
    try {
      const context = await recovery;
      verifyTerminalReviewContext(context);
      return { ok: true, context };
    } catch (error) {
      return {
        ok: false,
        refusal: managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
          capability: "wk_context_review",
          reason: "terminal_candidate_recovery_failed",
          recovery_code: typeof error?.code === "string"
            ? error.code
            : "terminal_candidate_recovery_mechanical_disagreement",
          subject: reviewAddress.subject,
          message: error?.message ?? String(error)
        })
      };
    } finally {
      if (terminalCandidateRecoveryInFlight.get(reviewAddress.subject) === recovery) {
        terminalCandidateRecoveryInFlight.delete(reviewAddress.subject);
      }
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
    const committedAdmission = resolveCommittedSliceReviewAdmission({
      mainRepo: worktreeProvisioningConfig.mainRepo,
      worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
      subject: reviewUnit.subject,
      reviewUnit,
      runGit: reviewContextRunGit
    });
    if (committedAdmission.target.sha !== target.sha ||
        committedAdmission.target.diff_base_sha !== target.diff_base_sha ||
        committedAdmission.worktree_path !== worktreePath) {
      throw new Error("canonical committed-slice admission disagrees with the frozen worker target");
    }
    const existing = frozenSliceReviewContexts.get(reviewUnit.subject) ?? null;
    if (existing !== null) {
      if (existing.reviewed_sha === target.sha &&
          existing.diff_base_sha === target.diff_base_sha &&
          existing.source_worker_run_id === status.run_id) {
        return existing;
      }
    }
    const trustedFrozenReviewContract = createTrustedFrozenSliceReviewContract(reviewUnit);
    const reviewerDependencyProjection = prepareReviewerDependencyProjection({
      mainRepo: worktreeProvisioningConfig.mainRepo,
      checkoutPath: worktreePath,
      projectionRoot: path.join(
        worktreeProvisioningConfig.worktreeRoot,
        ".reviewer-dependencies",
        committedAdmission.committed_target_digest,
        "node_modules"
      )
    });
    const context = Object.freeze({
      schema_version: "workspace-agent-frozen-slice-review-context.v1",
      review_admission_kind: committedAdmission.review_admission_kind,
      committed_target_digest: committedAdmission.committed_target_digest,
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
      empty_delivery: committedAdmission.empty_delivery === true,
      slice_level_review: true,
      source_worker_run_id: status.run_id,
      source_worker_monitor_handle: status.monitor_handle ?? status.run_id,
      source_worker_subject: status.subject,
      worktree_identity: committedAdmission.identity,
      worktree_identity_digest: digestTrustedExactReviewEvidence(committedAdmission.identity),
      reviewer_dependency_binds: reviewerDependencyProjection.read_only_binds,
      review_evidence_semantics: "append_only_advisory"
    });
    frozenSliceReviewContexts.set(reviewUnit.subject, context);
    return context;
  }

  async function resolveSliceReviewEvidenceSet({ subject } = {}) {
    const context = frozenSliceReviewContexts.get(subject) ?? null;
    if (context === null || context.slice_level_review !== true) return null;
    const targetKey = sliceReviewTargetKey(context);
    const applicableRuns = [...sliceReviewRunContexts.entries()]
      .filter(([, runContext]) => sliceReviewTargetKey(runContext) === targetKey)
      .map(([runId]) => runs.get(runId))
      .filter(Boolean);
    const activeRuns = applicableRuns.filter((record) => record.terminal !== true);
    const receipts = exactSliceReviewReceiptStore === null
      ? []
      : await exactSliceReviewReceiptStore.loadAll({
          unit_address: subject,
          ...(context.committed_target_digest
            ? { committed_target_digest: context.committed_target_digest }
            : {})
        });
    const receiptByRun = new Map(receipts.map((receipt) => [receipt.review_run_id, receipt]));
    const terminalRunsWithoutReceipt = applicableRuns
      .filter((record) => record.terminal === true && !receiptByRun.has(record.run_id));
    const cleanReceipts = receipts.filter((receipt) =>
      receiptCarriesUsableReviewVerdict(receipt) &&
      receipt.structured_outcome?.outcome === "clean" &&
      receipt.structured_outcome.clean_review === true
    );
    const findingReceipts = receipts.filter((receipt) =>
      receiptCarriesUsableReviewVerdict(receipt) &&
      receipt.structured_outcome?.outcome === "changes_requested"
    );
    const invalidReceipts = receipts.filter((receipt) =>
      !receiptCarriesUsableReviewVerdict(receipt) || receipt.structured_outcome === null
    );
    const activeReviewRunIds = activeRuns.map((record) => record.run_id).sort();
    const cleanReviewRunIds = cleanReceipts.map((receipt) => receipt.review_run_id).sort();
    const findingsReviewRunIds = findingReceipts.map((receipt) => receipt.review_run_id).sort();
    const invalidReviewRunIds = [
      ...invalidReceipts.map((receipt) => receipt.review_run_id),
      ...terminalRunsWithoutReceipt.map((record) => record.run_id)
    ].sort();
    return Object.freeze({
      schema_version: "workspace-agent-slice-review-advisory-evidence.v1",
      unit_address: context.review_subject,
      initiative: context.initiative,
      slice_ref: context.slice_ref,
      reviewed_sha: context.reviewed_sha,
      diff_base_sha: context.diff_base_sha,
      ...(context.review_admission_kind === "canonical_committed_slice"
        ? {
            review_admission_kind: context.review_admission_kind,
            committed_target_digest: context.committed_target_digest
          }
        : { source_worker_run_id: context.source_worker_run_id }),
      active_review_run_ids: Object.freeze(activeReviewRunIds),
      clean_review_run_ids: Object.freeze(cleanReviewRunIds),
      findings_review_run_ids: Object.freeze(findingsReviewRunIds),
      invalid_review_run_ids: Object.freeze(invalidReviewRunIds),
      reviews: Object.freeze(receipts.map((receipt) => Object.freeze({
        run_id: receipt.review_run_id,
        monitor_handle: receipt.review_monitor_handle,
        role: receipt.reviewer_role,
        terminal_disposition: receipt.terminal_run_status,
        structured_result_digest: receipt.trusted_evidence_digest,
        outcome: receipt.structured_outcome?.outcome ?? null,
        findings: Object.freeze((receipt.structured_outcome?.findings ?? []).map((finding) =>
          deepFreezeCanonicalSnapshot(finding)
        )),
        finding_counts: receipt.structured_outcome?.finding_counts
          ? deepFreezeCanonicalSnapshot(receipt.structured_outcome.finding_counts)
          : null
      }))),
      observation_complete: activeReviewRunIds.length === 0 &&
        terminalRunsWithoutReceipt.length === 0,
      authority: "advisory_only"
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

          resolveCommittedSliceIntegrationContinuation,

          retireManagedWorkerIdentity
        }
      });

  const startSliceReviewLaunch = async (input, boundContext) => {
    const context = boundContext;
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
    if (context.review_admission_kind === "canonical_committed_slice") {
      try {
        const currentUnit = resolveCanonicalSliceReviewUnit(context.main_repo, context.review_subject);
        const currentAdmission = resolveCommittedSliceReviewAdmission({
          mainRepo: context.main_repo,
          worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
          subject: context.review_subject,
          reviewUnit: currentUnit,
          runGit: reviewContextRunGit
        });
        if (currentAdmission.committed_target_digest !== context.committed_target_digest ||
            currentAdmission.worktree_path !== context.worktree_path ||
            currentAdmission.target.sha !== context.reviewed_sha ||
            currentAdmission.target.diff_base_sha !== context.diff_base_sha) {
          throw new Error("canonical committed-slice admission changed before spawn");
        }
      } catch (error) {
        return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
          capability: "slice_context_review",
          reason: "frozen_slice_review_context_stale_or_mismatched",
          message: error?.message ?? String(error)
        });
      }
    }

    let launch;
    try {
      launch = await lifecycle.startLaunch({
        ...input,

        workspace_dir: context.worktree_path,

        config_root_dir: context.main_repo,
        trusted_frozen_review_contract: context.trusted_frozen_review_contract,
        reviewer_dependency_binds: context.reviewer_dependency_binds ?? [],
        readiness: Object.freeze({
          ...(isPlainObject(input.readiness) ? input.readiness : {}),
          frozen_slice_review_target: Object.freeze({
            ref: context.slice_ref,
            sha: context.reviewed_sha,
            diff_base_sha: context.diff_base_sha,
            diff_head_sha: context.diff_head_sha,
            diff_range: context.diff_range,
            empty_delivery: context.empty_delivery === true,
            slice_level_review: true
          })
        })
      });
    } catch (error) {
      throw error;
    }
    if (launch?.accepted === true) {
      sliceReviewRunContexts.set(launch.run_id, context);
      const launchedRecord = runs.get(launch.run_id) ?? null;
      if (launchedRecord !== null) {
        await captureSliceReviewTerminalResult({ record: launchedRecord });
      }
    } else {

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

  const prepareCanonicalCommittedSliceReviewAdmission = async ({
    subject,
    workspace_dir: workspaceDir
  } = {}) => {
    if (!worktreeProvisioningConfig || postWorkerSliceLifecycle === null ||
        typeof subject !== "string" || !EXACT_IMPLEMENTATION_SLICE_RE.test(subject) ||
        path.resolve(workspaceDir ?? "") !== worktreeProvisioningConfig.mainRepo) {
      return Object.freeze({ ok: false, reason: "canonical_committed_slice_review_unavailable" });
    }
    try {
      const reviewUnit = resolveCanonicalSliceReviewUnit(
        worktreeProvisioningConfig.mainRepo,
        subject
      );
      const admission = resolveCommittedSliceReviewAdmission({
        mainRepo: worktreeProvisioningConfig.mainRepo,
        worktreeRoot: worktreeProvisioningConfig.worktreeRoot,
        subject,
        reviewUnit,
        runGit: reviewContextRunGit
      });
      const context = Object.freeze({
        schema_version: "workspace-agent-frozen-slice-review-context.v1",
        review_admission_kind: admission.review_admission_kind,
        empty_delivery: admission.empty_delivery === true,
        committed_target_digest: admission.committed_target_digest,
        review_subject: subject,
        record_id: reviewUnit.record_id,
        review_slice_id: reviewUnit.slice_id,
        initiative: reviewUnit.initiative,
        canonical_parent_wk_contract: reviewUnit.canonical_parent_wk_contract,
        review_unit_contract: reviewUnit.review_unit_contract,
        trusted_frozen_review_contract: createTrustedFrozenSliceReviewContract(reviewUnit),
        main_repo: worktreeProvisioningConfig.mainRepo,
        worktree_path: admission.worktree_path,
        slice_ref: admission.target.ref,
        reviewed_sha: admission.target.sha,
        diff_base_sha: admission.target.diff_base_sha,
        diff_head_sha: admission.target.sha,
        diff_range: admission.target.diff_range,
        slice_level_review: true,
        worktree_identity: admission.identity,
        worktree_identity_digest: digestTrustedExactReviewEvidence(admission.identity),
        review_evidence_semantics: "append_only_advisory"
      });
      const raced = frozenSliceReviewContexts.get(subject) ?? null;
      if (raced !== null && sliceReviewTargetKey(raced) === sliceReviewTargetKey(context)) {
        return Object.freeze({
          ok: true,
          reason: null,
          reviewed_sha: raced.reviewed_sha,
          committed_target_digest: raced.committed_target_digest
        });
      }
      frozenSliceReviewContexts.set(subject, context);
      return Object.freeze({
        ok: true,
        reviewed_sha: context.reviewed_sha,
        committed_target_digest: context.committed_target_digest
      });
    } catch (error) {
      return Object.freeze({
        ok: false,
        reason: error?.detail?.reason ?? "canonical_committed_slice_review_refused",
        code: error?.code ?? COMMITTED_SLICE_REVIEW_ADMISSION_CODES.REFUSED
      });
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
    if (input?.role !== "reviewer" && input?.role !== "redteam") {
      return lifecycle.startLaunch(input);
    }

    const terminalCandidateCallerCarriers = [
      ...CALLER_REVIEW_CONTEXT_CARRIERS,
      "candidateRef", "candidate_ref", "candidateSha", "candidate_sha",
      "landingRef", "landing_ref", "landingSha", "landing_sha",
      "terminalCandidate", "terminal_candidate", "terminalCandidateContext",
      "terminal_candidate_context"
    ];
    const contextCarrier = firstOwnField(input, terminalCandidateCallerCarriers);
    const nestedContextCarrier = firstOwnField(input?.readiness, terminalCandidateCallerCarriers);
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
    let context = frozenReviewContexts.get(input.subject);
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
        const selectedSliceId = input.subject.slice(input.subject.indexOf("#") + 1);
        const selectedSlice = Array.isArray(record.slices)
          ? record.slices.find((slice) => slice?.id === selectedSliceId)
          : null;
        const terminalContractDeclared = Array.isArray(record.slices) && record.slices.some(
          (slice) => slice?.review_purpose === "terminal_whole_wk"
        );
        if (selectedSlice?.work_kind === "review" &&
            selectedSlice.review_purpose !== "terminal_whole_wk" &&
            !terminalContractDeclared) {
          return lifecycle.startLaunch(input);
        }
        if (recoverTerminalCandidate === null) {
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
        }
        const recovered = await recoverTerminalReviewContext({
          record_id: subjectMatch[1],
          subject: input.subject
        });
        if (recovered.ok !== true) return recovered.refusal;
        context = recovered.context;
      }
      if (!context) return lifecycle.startLaunch(input);
    }
    if (path.resolve(input.workspace_dir ?? "") !== context.main_repo) {
      return managedRefusal(MANAGED_LIFECYCLE_REQUIRED, {
        capability: "wk_context_review",
        reason: "frozen_review_context_workspace_mismatch"
      });
    }
    if (context.review_identity_kind !== "terminal_candidate") {
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
    }
    if (context.review_identity_kind === "terminal_candidate") {
      try {
        verifyTerminalReviewContext(context);
      } catch (error) {
        const recovered = await recoverTerminalReviewContext({
          record_id: context.record_id,
          subject: context.review_subject
        });
        if (recovered.ok !== true) return recovered.refusal;
        context = recovered.context;
      }
    } else {
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
    }

    let launch;
    try {
      launch = await lifecycle.startLaunch({
        ...input,
        workspace_dir: context.worktree_path,

        config_root_dir: context.main_repo,
        trusted_frozen_review_contract: context.trusted_frozen_review_contract,
        reviewer_dependency_binds: context.reviewer_dependency_binds ?? [],
        readiness: Object.freeze({
          ...(isPlainObject(input.readiness) ? input.readiness : {}),
          ...(context.review_identity_kind === "terminal_candidate"
            ? { frozen_terminal_candidate_review_target: Object.freeze({
                review_identity_kind: "terminal_candidate",
                candidate_ref: context.candidate_ref,
                candidate_sha: context.candidate_sha,
                landing_ref: context.landing_ref,
                landing_sha: context.landing_sha,
                wk_ref: context.wk_ref,
                wk_sha: context.wk_sha,
                diff_base_sha: context.landing_sha,
                diff_head_sha: context.candidate_sha,
                diff_range: `${context.landing_sha}..${context.candidate_sha}`,
                canonical_wk_digest: context.canonical_wk_digest,
                complete_parent_wk_contract: true,
                accumulated_wk_diff: true
              }) }
            : { frozen_wk_review_target: Object.freeze({
                ref: context.wk_ref,
                sha: context.wk_sha,
                diff_base_sha: context.diff_base_sha,
                diff_head_sha: context.diff_head_sha,
                diff_range: context.diff_range,
                complete_parent_wk_contract: true,
                accumulated_wk_diff: true
              }) }),
          reviewer_validation_evidence: context.reviewer_validation_evidence ?? []
        })
      });
    } catch (error) {
      throw error;
    }
    if (launch?.accepted === true) {
      wholeReviewRunContexts.set(launch.run_id, context);
    } else {

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

    try {
      resolveCanonicalSliceReviewUnit(worktreeProvisioningConfig.mainRepo, subject);
      return null;
    } catch {

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
              resolveCanonicalSliceReviewUnit: ({ mainRepo, subject: sliceSubject }) =>
                resolveCanonicalSliceReviewUnit(mainRepo, sliceSubject),
              bindFrozenSliceReviewContext,

              resolveManagedWorkerProvenDeath,

              retireManagedWorkerIdentity,
              recoveryOnly: true
            }
          });

          const retiredNoCommit =
            lifecycleResult?.phase === "finalized" &&
            lifecycleResult.integrated === false &&
            lifecycleResult.integration === null &&
            lifecycleResult.recovered_from_proven_death === true &&
            lifecycleResult.retired === true &&
            lifecycleResult.retirement_reason === "no_commit_base_equal";
          if (!lifecycleResult ||
              (!retiredNoCommit &&
                (lifecycleResult.phase !== "finalized" ||
                  lifecycleResult.integration?.recovered !== true))) {
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

  const recoverExactSliceReviewRun = async ({ workspace, monitor_handle, subject } = {}) => {
    if (exactSliceReviewReceiptStore === null ||
        !workspace || path.resolve(workspace.dir ?? "") !== worktreeProvisioningConfig?.mainRepo ||
        typeof monitor_handle !== "string" || typeof subject !== "string" ||
        !EXACT_IMPLEMENTATION_SLICE_RE.test(subject)) return null;
    const receipt = await exactSliceReviewReceiptStore.load({
      unit_address: subject,
      monitor_handle
    });
    if (receipt === null) return null;
    return Object.freeze({
      status: Object.freeze({
        accepted: true,
        recovered: true,
        run_id: receipt.review_run_id,
        monitor_handle: receipt.review_monitor_handle,
        role: receipt.reviewer_role,
        subject,
        status: receipt.terminal_run_status,
        terminal: true,
        ...(receipt.structured_outcome?.outcome === "clean"
          ? { review_result: receipt.structured_outcome.review_result }
          : {}),
        final_result: null
      }),
      lifecycle: Object.freeze({
        invoked: false,
        integrated: false,
        reason: "advisory_review_recovered_coordinator_continuation_required",
        next_action: "call_workspace_integrate_committed_slice"
      }),
      review_evidence: receipt
    });
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

  function resolveTerminalCandidatePublicationState(wkId) {
    if (typeof wkId !== "string" || !/^WK-\d{4}$/u.test(wkId)) return null;
    const targetKey = currentTerminalReviewTargetByWk.get(wkId);
    if (targetKey === undefined) return null;
    const context = frozenReviewContextsByTarget.get(targetKey);
    if (context === undefined) return null;
    const records = [...wholeReviewRunContexts.entries()]
      .filter(([, runContext]) => wholeReviewTargetKey(runContext) === targetKey)
      .map(([runId]) => runs.get(runId))
      .filter(Boolean);
    if (verifyFrozenWkReviewTargetAgainstObjectStore({
      mainRepo: context.main_repo,
      context,
      runGit: reviewContextRunGit
    }).ok !== true) return null;
    verifyTerminalCandidateCheckout({
      binding: context.terminal_candidate_binding,
      candidateRoot: context.terminal_candidate_materialization.candidate_root,
      runGit: reviewContextRunGit
    });
    const advisoryReviews = records.map((record) => {
      const outcome = structuredReceiptOutcome(record);
      let provenanceValid = false;
      try {
        assertRetainedReviewerLaunchIdentityMatchesContext(record.reviewer_launch_identity, context);
        provenanceValid = true;
      } catch {

      }
      return Object.freeze({
        run_id: record.run_id,
        monitor_handle: record.monitor_handle ?? null,
        role: record.role ?? "reviewer",
        terminal: record.terminal === true,
        status: record.status ?? null,
        provenance_valid: provenanceValid,
        outcome: outcome?.outcome ?? null,
        review_result: outcome === null ? null : deriveBackendReviewResult(record)
      });
    });
    return Object.freeze({
      binding: context.terminal_candidate_binding,
      materialization: context.terminal_candidate_materialization,
      advisory_review_evidence: Object.freeze({
        schema_version: "workspace-agent-terminal-review-advisory-evidence.v1",
        authority: "advisory_only",
        candidate_sha: context.candidate_sha,
        landing_sha: context.landing_sha,
        wk_sha: context.wk_sha,
        reviews: Object.freeze(advisoryReviews)
      })
    });
  }

  return {
    schema_version: WORKSPACE_AGENT_DISPATCH_BACKEND_SCHEMA_VERSION,
    startLaunch,
    getRunStatus: lifecycle.getRunStatus,
    waitForRunStatus: lifecycle.waitForRunStatus,
    planLaunch: lifecycle.planLaunch,
    getManagedLifecycleCapabilityAuthorityFacts,
    isLauncherOwnedExactSliceReviewAdmission,

    resolveSliceReviewEvidenceSet,
    requestCommittedSliceIntegration,
    resolveCommittedSliceIntegrationContinuation,
    resolveTerminalCandidatePublicationState,
    prepareCanonicalCommittedSliceReviewAdmission,
    ...(runPostWorkerSliceLifecycle !== null
      ? {
          runPostWorkerSliceLifecycle,
          recoverIntegratedWorkerRun,
          recoverExactSliceReviewRun
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
      resolveCanonicalFindingsOnlyReviewUnit(mainRepo, wkId)
  };
}
