import { loadWorkRecordById } from "@agent-chassis/wiki-core";
import {
  resolveLauncherSchemaConstrainedTierIsPaid,
  resolveLauncherSchemaConstrainedTierResolution,
  LAUNCHER_SCHEMA_CONSTRAINED_TIER_STATES
} from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import path from "node:path";
import { statSync } from "node:fs";
import {
  adaptFamilyBrokerRefusal
} from "./workspace-agent-family-launch-policy.mjs";
import {
  HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS
} from "./host-write-authority-substrate.mjs";
import {
  createLauncherOwnedSourceToolSurfacePreparer
} from "./agent-backend.mjs";
import {
  CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS
} from "./workspace-agent-codex-launch-policy.mjs";
import {
  buildCodexLaunchArtifacts,
  mapCodexArtifactsFailureToBrokerRefusal,
  resolveCodexTerminalStructuredRoleResultMode
} from "./workspace-agent-dispatch-codex-launch-support.mjs";
import {
  buildCodexDispatchWorkerPlanArgs
} from "./workspace-agent-dispatch-codex-plan-args.mjs";
import {
  captureCodexFinalResultFromPlan
} from "./workspace-agent-dispatch-codex-provenance.mjs";
import { resolveFindingsOnlyAcceptanceContract } from "./workspace-agent-findings-role-context.mjs";
import { assertFrozenWorkerScopeAuthority } from "./workspace-agent-launch-core.mjs";

function deriveManagedWorktreeGitBinding(provisioning) {
  const mainRepo = provisioning.main_repo;
  const worktreePath = provisioning.worktree_path;
  const mainGitDir = path.join(mainRepo, ".git");
  const gitDir = path.join(mainGitDir, "worktrees", path.basename(worktreePath));
  const gitPointerFile = path.join(worktreePath, ".git");
  return Object.freeze({
    worktreePath,
    gitDir,
    mainGitDir,
    gitPointerFile
  });
}

function firstManagedProvisioningAttemptMismatch({
  provisioning,
  codexRole,
  subject,
  workspaceDir,
  monitorHandle,
  runId,
  workerScopeAuthority
}) {
  const mismatch = (field, expected, actual) => ({ field, expected, actual: actual ?? null });
  if (codexRole !== "worker") {
    return mismatch("role", "worker", codexRole);
  }
  const sliceBinding = provisioning?.slice_binding ?? null;
  if (sliceBinding === null || typeof sliceBinding !== "object") {
    return mismatch("slice_binding", "object", sliceBinding);
  }

  const expectedSubject = `${provisioning.record_id}#${provisioning.slice_id}`;
  if (subject !== expectedSubject) {
    return mismatch("subject", expectedSubject, subject);
  }
  const selected = workerScopeAuthority?.selected_unit ?? null;
  if (selected !== null) {
    if (provisioning.unit_address !== workerScopeAuthority.unit_address) {
      return mismatch("unit_address", workerScopeAuthority.unit_address, provisioning.unit_address);
    }
    if (provisioning.record_id !== selected.record_id) {
      return mismatch("record_id", selected.record_id, provisioning.record_id);
    }
    if (provisioning.slice_id !== selected.slice_id) {
      return mismatch("slice_id", selected.slice_id, provisioning.slice_id);
    }
  }

  if (workspaceDir === null || workspaceDir !== provisioning.worktree_path) {
    return mismatch("workspace_dir", provisioning.worktree_path, workspaceDir);
  }

  if (monitorHandle !== sliceBinding.launch_ref) {
    return mismatch("monitor_handle", sliceBinding.launch_ref, monitorHandle);
  }
  const expectedSliceRunId = runId === null ? null : `${runId}.slice`;
  if (expectedSliceRunId !== sliceBinding.run_id) {
    return mismatch("run_id", sliceBinding.run_id, expectedSliceRunId);
  }
  if (provisioning.retry_id !== sliceBinding.retry_id) {
    return mismatch("retry_id", sliceBinding.retry_id, provisioning.retry_id);
  }

  if (typeof provisioning.run_authority !== "string" || provisioning.run_authority.length === 0) {
    return mismatch("run_authority", "non-empty", provisioning.run_authority);
  }
  if (typeof sliceBinding.run_authority === "string" &&
      sliceBinding.run_authority !== provisioning.run_authority) {
    return mismatch("slice_binding.run_authority", provisioning.run_authority, sliceBinding.run_authority);
  }

  const expectedWriteScopeSource =
    `wiki/work-records/${provisioning.record_id}.json#${provisioning.slice_id}`;
  if (sliceBinding.write_scope_source !== expectedWriteScopeSource) {
    return mismatch("slice_binding.write_scope_source", expectedWriteScopeSource, sliceBinding.write_scope_source);
  }
  if (sliceBinding.unit_address !== provisioning.unit_address) {
    return mismatch("slice_binding.unit_address", provisioning.unit_address, sliceBinding.unit_address);
  }
  return null;
}

function canonicalReviewerConfigRootIsReadable(configRootDir) {
  try {
    return statSync(configRootDir).isDirectory();
  } catch {
    return false;
  }
}

export function createHostWriteAuthorityBrokerPlanLaunchImpl({
  options = {},
  deps
} = {}) {
  const {
    buildPlan = deps.buildPlan,
    buildBwrapPlan = deps.buildBwrapPlan,
    ensureWriteRoots = deps.ensureWriteRoots,
    env = process.env,
    cwd: defaultCwd = process.cwd(),
    promptArgs = [],
    resolvedProfile = null,
    prepareSourceToolSurface = null,
    captureFinalResult = deps.captureFinalResult,

    resolveSchemaConstrainedTier = resolveLauncherSchemaConstrainedTierIsPaid,

    resolveSchemaConstrainedTierResolution = resolveLauncherSchemaConstrainedTierResolution,
    loadWorkRecord = loadWorkRecordById
  } = options;

  const injectedSourceSurfacePreparer = typeof prepareSourceToolSurface === "function"
    ? prepareSourceToolSurface
    : null;
  return async function brokerPlanLaunch(launchInput, launchContext = {}) {
    const codexRole = typeof launchInput?.codex_role === "string"
      ? launchInput.codex_role
      : null;

    const workerMcpHostWriteEndpoint =
      codexRole === "worker" &&
      typeof launchContext?.workerMcpHostWriteEndpoint === "string" &&
      launchContext.workerMcpHostWriteEndpoint.length > 0
        ? launchContext.workerMcpHostWriteEndpoint
        : null;
    const subject = typeof launchInput?.subject === "string"
      ? launchInput.subject
      : null;
    const workspaceAlias = typeof launchInput?.workspace_alias === "string" && launchInput.workspace_alias.length > 0
      ? launchInput.workspace_alias
      : null;
    const workspaceDir = typeof launchInput?.workspace_dir === "string"
      && launchInput.workspace_dir.length > 0
      ? launchInput.workspace_dir
      : null;

    if (!codexRole) {
      return adaptFamilyBrokerRefusal({
        reason: "broker_codex_role_missing",
        detail: { received: launchInput?.codex_role ?? null }
      });
    }
    if (!subject) {
      return adaptFamilyBrokerRefusal({
        reason: "broker_subject_missing",
        detail: { received: launchInput?.subject ?? null }
      });
    }
    if (Object.prototype.hasOwnProperty.call(launchInput ?? {}, "workerScopeAuthority")) {
      return adaptFamilyBrokerRefusal({
        reason: "worker_scope_authority_invalid",
        detail: { message: "caller-controlled workerScopeAuthority alias is forbidden" }
      });
    }

    const brokerWorkerScopeAuthority = launchInput?.worker_scope_authority ?? null;

    const brokerWorktreeProvisioning = launchInput?.worktree_provisioning ?? null;
    const brokerManagedAuthorityRequired = codexRole === "worker" && (
      brokerWorkerScopeAuthority !== null || brokerWorktreeProvisioning !== null
    );
    try {
      assertFrozenWorkerScopeAuthority(brokerWorkerScopeAuthority, {
        role: codexRole,
        subject,

        worktreeProvisioning: brokerWorktreeProvisioning,
        required: brokerManagedAuthorityRequired
      });
    } catch (error) {
      return adaptFamilyBrokerRefusal({
        reason: "worker_scope_authority_invalid",
        detail: { message: error?.message ?? String(error) }
      });
    }

    if (brokerManagedAuthorityRequired && brokerWorktreeProvisioning === null) {
      return adaptFamilyBrokerRefusal({
        reason: "worker_scope_authority_invalid",
        detail: {
          issue: "managed_provisioning_carrier_missing",
          message: "managed worker requires its launcher-owned worktree provisioning carrier before source preparation"
        }
      });
    }

    let brokerDerivedWorktreeGitBinding = null;
    if (brokerWorktreeProvisioning !== null) {
      const attemptMismatch = firstManagedProvisioningAttemptMismatch({
        provisioning: brokerWorktreeProvisioning,
        codexRole,
        subject,
        workspaceDir,
        monitorHandle: typeof launchInput?.monitor_handle === "string" ? launchInput.monitor_handle : null,
        runId: typeof launchInput?.run_id === "string" ? launchInput.run_id : null,
        workerScopeAuthority: brokerWorkerScopeAuthority
      });
      if (attemptMismatch !== null) {
        return adaptFamilyBrokerRefusal({
          reason: "worker_scope_authority_invalid",
          detail: { issue: "managed_provisioning_attempt_identity_mismatch", ...attemptMismatch }
        });
      }

      brokerDerivedWorktreeGitBinding = deriveManagedWorktreeGitBinding(brokerWorktreeProvisioning);
    }

    const brokerSourceSurfacePreparer = injectedSourceSurfacePreparer
      ?? createLauncherOwnedSourceToolSurfacePreparer({
        env,
        cwd: defaultCwd,
        launcherAuthorityWorkspaceDir: brokerWorktreeProvisioning?.main_repo ?? null
      });

    const brokerSourceSurfacePolicy = await deps.resolveCodexWorkerSourceSurfacePolicy({
      role: codexRole,
      suppliedSourceToolSurface: launchInput?.source_tool_surface ?? null,
      preparer: brokerSourceSurfacePreparer,
      preparerInput: {
        app: "codex",
        role: "worker",
        subject,
        workspace_alias: workspaceAlias,
        workspace_dir: workspaceDir,
        readiness: launchInput?.readiness ?? null,
        run_id: typeof launchInput?.run_id === "string" ? launchInput.run_id : null,
        model: launchInput?.model ?? null,
        worker_scope_authority: brokerWorkerScopeAuthority
      }
    });
    if (
      brokerSourceSurfacePolicy.disposition
      === CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS.REFUSAL
    ) {
      return adaptFamilyBrokerRefusal({
        reason: brokerSourceSurfacePolicy.reason,
        detail: brokerSourceSurfacePolicy.detail
      });
    }
    if (
      codexRole === "worker" && brokerWorkerScopeAuthority !== null &&
      brokerSourceSurfacePolicy.disposition
        === CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS.CALLABLE_SURFACE
    ) {
      return adaptFamilyBrokerRefusal({
        reason: "managed_worker_tool_profile_drift",
        detail: { issue: "general_mcp_surface_forbidden", allowed_tools: ["commit"] }
      });
    }
    const sourceToolSurface = brokerSourceSurfacePolicy.forwardedSourceToolSurface;

    const managedWorkerModelResolution =
      codexRole === "worker" && brokerWorktreeProvisioning !== null;
    const brokerModelGate = await deps.evaluateDispatchRoleModelGate({
      role: codexRole,

      isWorker: managedWorkerModelResolution ? false : codexRole === "worker",
      resolvedProfile,
      modelHint: launchInput?.model,

      cwd: managedWorkerModelResolution
        ? brokerWorktreeProvisioning.main_repo
        : workspaceDir ?? defaultCwd
    });
    if (!brokerModelGate.ok) {
      return adaptFamilyBrokerRefusal({
        reason: brokerModelGate.reason,
        detail: brokerModelGate.detail
      });
    }
    const effectiveResolvedProfile = brokerModelGate.resolvedProfile;

    let findingsOnlyAcceptance;
    try {
      findingsOnlyAcceptance = await resolveFindingsOnlyAcceptanceContract({
        role: codexRole,
        subject,
        workspaceDir: workspaceDir ?? defaultCwd,
        loadWorkRecord,

        frozenReviewContract: launchInput?.trusted_frozen_review_contract ?? null
      });
    } catch (err) {
      return adaptFamilyBrokerRefusal({
        reason: HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS.PLAN_THREW,
        detail: {
          stage: "findings_only_acceptance_contract",
          message: err?.message ?? String(err),
          code: err?.code ?? null,
          detail: err?.detail ?? null
        }
      });
    }

    const managedReviewerCanonicalConfigRoot =
      codexRole === "review" &&
      typeof launchInput?.config_root_dir === "string" &&
      launchInput.config_root_dir.length > 0
        ? launchInput.config_root_dir
        : null;
    let brokerSchemaConstrainedTierIsPaid;
    if (managedReviewerCanonicalConfigRoot !== null) {
      if (!canonicalReviewerConfigRootIsReadable(managedReviewerCanonicalConfigRoot)) {
        return adaptFamilyBrokerRefusal({
          reason: "reviewer_canonical_config_unreadable",
          detail: {
            issue: "managed_reviewer_canonical_config_unreadable",
            message: "managed findings-only reviewer requires a readable launcher-minted canonical configuration root to resolve its paid-tier/output-schema fact"
          }
        });
      }

      const managedReviewerTierResolution =
        resolveSchemaConstrainedTierResolution({ workspaceDir: managedReviewerCanonicalConfigRoot });
      if (
        managedReviewerTierResolution.state
        === LAUNCHER_SCHEMA_CONSTRAINED_TIER_STATES.READ_FAILURE
      ) {
        return adaptFamilyBrokerRefusal({
          reason: "reviewer_canonical_config_env_unreadable",
          detail: {
            issue: "managed_reviewer_canonical_config_env_unreadable",

            cause_code: managedReviewerTierResolution.cause_code,
            message: "managed findings-only reviewer requires a readable canonical .env to resolve its paid-tier/output-schema fact; the present .env could not be read"
          }
        });
      }
      brokerSchemaConstrainedTierIsPaid = managedReviewerTierResolution.is_paid === true;
    } else {
      brokerSchemaConstrainedTierIsPaid = workspaceDir
        ? resolveSchemaConstrainedTier({ workspaceDir }) === true
        : false;
    }
    const terminalStructuredRoleResultMode = resolveCodexTerminalStructuredRoleResultMode({
      schemaConstrainedTierIsPaid: brokerSchemaConstrainedTierIsPaid,
      codexRole
    });

    const artifacts = await buildCodexLaunchArtifacts({
      planArgs: buildCodexDispatchWorkerPlanArgs({
        role: codexRole,
        subject,
        promptArgs,
        env,
        cwd: workspaceDir ?? defaultCwd,

        resolvedProfile: effectiveResolvedProfile,
        workspaceAlias,
        workspaceDir,
        acceptanceCriteria: findingsOnlyAcceptance?.acceptanceCriteria ?? [],
        acceptanceValidation: findingsOnlyAcceptance?.acceptanceValidation ?? [],
        sourceToolSurface,

        terminalStructuredRoleResultMode,
        dispatchWorktreeRoot: launchInput?.dispatchWorktreeRoot ?? null,

        provisionedWorktreeGitBinding: brokerDerivedWorktreeGitBinding,
        provisioned_worktree_git_binding: brokerDerivedWorktreeGitBinding,
        worker_scope_authority: brokerWorkerScopeAuthority,

        hostWriteAuthorityEndpoint: workerMcpHostWriteEndpoint,

        worktree_provisioning: brokerWorktreeProvisioning,

        configRootDir: launchInput?.config_root_dir ?? null,
        trustedFrozenReviewContract: launchInput?.trusted_frozen_review_contract ?? null
      }),
      buildPlan,
      buildBwrapPlan,
      ensureWriteRoots,

      assertBwrap: () => undefined
    });
    if (!artifacts.ok) {
      return mapCodexArtifactsFailureToBrokerRefusal(artifacts);
    }
    return {
      ok: true,
      plan: artifacts.plan,
      bwrapPlan: artifacts.bwrapPlan,
      parseFinalResult: captureCodexFinalResultFromPlan(captureFinalResult)
    };
  };
}
