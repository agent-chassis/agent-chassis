

import {
  BACKEND_REFUSAL_CODES,

  validateLauncherFamilyRole
} from "./workspace-agent-dispatch-backend.mjs";
import { loadWorkRecordById } from "@agent-chassis/wiki-core";

import { assertFrozenWorkerScopeAuthority } from "./workspace-agent-launch-core.mjs";

import { resolveFamilyExecutorRole } from "./workspace-agent-family-launch-policy.mjs";
import { HOST_WRITE_AUTHORITY_SUBSTRATE_ID } from "./host-write-authority-substrate.mjs";
import {
  assertBubblewrapAvailable,
  spawnIsolated
} from "./launch-isolation.mjs";
import {
  buildCodexRolePlan,
  buildCodexRoleBubblewrapPlan
} from "../commands/codex-role.mjs";
import {
  createLauncherOwnedSourceToolSurfacePreparer
} from "./agent-backend.mjs";
import { ensureNewWorkerWriteRoots } from "./codex-worker-plan.mjs";

import {
  CODEX_LAUNCH_POLICY_ENACTMENT,
  CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS,
  classifyCodexLaunchEnactment
} from "./workspace-agent-codex-launch-policy.mjs";
import { defaultCaptureCodexFinalResult } from "./workspace-agent-codex-final-result.mjs";
import { resolveFindingsOnlyAcceptanceContract } from "./workspace-agent-findings-role-context.mjs";
import { renderTrustedCorrectiveFindingsInstructions } from "./workspace-agent-launch-adapter-contract.mjs";
import {
  CODEX_EXECUTOR_ROLE_MAP,
  makeRefusal,
  resolveCodexTerminalStructuredRoleResultMode
} from "./workspace-agent-dispatch-codex-launch-support.mjs";
import {
  SOURCE_SURFACE_FAIL_CLOSED_CODE,
  evaluateDispatchRoleModelGate,
  resolveCodexWorkerSourceSurfacePolicy
} from "./workspace-agent-dispatch-codex-executor-policy.mjs";
import {
  launchCodexWorkspaceAgentInProcess,
  spawnPlainChildProcess
} from "./workspace-agent-dispatch-codex-in-process-runtime.mjs";

import {
  resolveLauncherSchemaConstrainedTierIsPaid,
  resolveLauncherSchemaConstrainedTierResolution,
  LAUNCHER_SCHEMA_CONSTRAINED_TIER_STATES
} from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import { statSync } from "node:fs";

function isReadableCanonicalConfigRoot(configRootDir) {
  try {
    return statSync(configRootDir).isDirectory();
  } catch {
    return false;
  }
}

export function createCodexWorkspaceAgentLaunchExecutor(options = {}) {
  const {
    buildPlan = buildCodexRolePlan,
    buildBwrapPlan = buildCodexRoleBubblewrapPlan,
    ensureWriteRoots = ensureNewWorkerWriteRoots,
    assertBwrap = assertBubblewrapAvailable,
    spawn = spawnIsolated,
    plainSpawn = spawnPlainChildProcess,
    env = process.env,
    cwd: defaultCwd = process.cwd(),
    promptArgs = [],
    resolvedProfile = null,
    captureFinalResult = defaultCaptureCodexFinalResult,

    killTimeoutMs = null,

    hostWriteAuthority = null,

    prepareSourceToolSurface = null,
    resolveUnsandboxedOptIn = undefined,
    classifyIsolationBackendAvailability = undefined,
    probeCanonicalBwrapAvailability = undefined,

    resolveSchemaConstrainedTier = resolveLauncherSchemaConstrainedTierIsPaid,

    resolveSchemaConstrainedTierResolution = resolveLauncherSchemaConstrainedTierResolution,
    loadWorkRecord = loadWorkRecordById
  } = options;

  const sourceSurfacePreparer = typeof prepareSourceToolSurface === "function"
    ? prepareSourceToolSurface
    : createLauncherOwnedSourceToolSurfacePreparer({ env, cwd: defaultCwd });

  return async function codexLaunchExecutor(input) {
    const role = input?.role ?? null;
    const subject = input?.subject ?? null;
    const workspaceAlias = typeof input?.workspace_alias === "string" && input.workspace_alias.length > 0
      ? input.workspace_alias
      : null;
    const workspaceDir = typeof input?.workspace_dir === "string" && input.workspace_dir.length > 0
      ? input.workspace_dir
      : null;

    const roleResolution = resolveFamilyExecutorRole({
      role,
      validateRole: validateLauncherFamilyRole,
      roleMap: CODEX_EXECUTOR_ROLE_MAP
    });
    if (!roleResolution.ok) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "unsupported_role_for_codex_executor",
        { role }
      );
    }
    const codexRole = roleResolution.familyRole;
    if (typeof subject !== "string" || subject.length === 0) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "subject_required_for_codex_executor",
        null
      );
    }
    if (Object.prototype.hasOwnProperty.call(input ?? {}, "workerScopeAuthority")) {
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED, "worker_scope_authority_invalid", {
        message: "caller-controlled workerScopeAuthority alias is forbidden"
      });
    }
    const serverProvisionedWorktreeGitBinding = input?.provisionedWorktreeGitBinding
      ?? input?.provisioned_worktree_git_binding
      ?? null;
    const managedWorkerAuthorityRequired = codexRole === "worker" && (
      serverProvisionedWorktreeGitBinding !== null ||
      input?.worktree_provisioning != null ||
      input?.worker_scope_authority != null
    );
    try {
      assertFrozenWorkerScopeAuthority(input?.worker_scope_authority ?? null, {
        role: codexRole,
        subject,
        worktreeProvisioning: input?.worktree_provisioning ?? null,
        provisionedWorktreeGitBinding: serverProvisionedWorktreeGitBinding,
        required: managedWorkerAuthorityRequired
      });
    } catch (error) {
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED, "worker_scope_authority_invalid", {
        message: error?.message ?? String(error)
      });
    }

    const launchEnactment = classifyCodexLaunchEnactment({
      hostWriteAuthorityConfigured: typeof hostWriteAuthority === "function"
    });
    const delegatingToHostWriteAuthority =
      launchEnactment.enactment
      === CODEX_LAUNCH_POLICY_ENACTMENT.DELEGATE_HOST_WRITE_AUTHORITY;

    let effectiveResolvedProfile = resolvedProfile;
    if (!delegatingToHostWriteAuthority) {
      const inProcessModelGate = await evaluateDispatchRoleModelGate({
        role,
        isWorker: role === "worker",
        resolvedProfile,
        modelHint: input?.model,
        cwd: workspaceDir ?? defaultCwd
      });
      if (!inProcessModelGate.ok) {
        return makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          inProcessModelGate.reason,
          inProcessModelGate.detail
        );
      }
      effectiveResolvedProfile = inProcessModelGate.resolvedProfile;
    }

    let findingsOnlyAcceptance;
    try {
      findingsOnlyAcceptance = await resolveFindingsOnlyAcceptanceContract({
        role: codexRole,
        subject,
        workspaceDir: workspaceDir ?? defaultCwd,
        loadWorkRecord,
        frozenReviewContract: input?.trusted_frozen_review_contract ?? null
      });
    } catch (err) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "codex_role_plan_build_threw",
        {
          message: err?.message ?? String(err),
          code: err?.code ?? null,
          detail: err?.detail ?? null
        }
      );
    }

    const suppliedSourceToolSurface = input?.source_tool_surface ?? null;

    let forwardedSourceToolSurface;
    if (delegatingToHostWriteAuthority) {
      forwardedSourceToolSurface = suppliedSourceToolSurface;
    } else {

      const sourceSurfacePolicy = await resolveCodexWorkerSourceSurfacePolicy({
        role,
        suppliedSourceToolSurface,
        preparer: sourceSurfacePreparer,
        preparerInput: {
          app: "codex",
          role: "worker",
          subject,
          workspace_alias: workspaceAlias,
          workspace_dir: workspaceDir,
          readiness: input?.readiness ?? null,
          run_id: typeof input?.run_id === "string" ? input.run_id : null,
          model: input?.model ?? null,
          worker_scope_authority: input?.worker_scope_authority ?? null
        }
      });
      if (
        sourceSurfacePolicy.disposition
        === CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS.REFUSAL
      ) {

        return makeRefusal(
          SOURCE_SURFACE_FAIL_CLOSED_CODE[sourceSurfacePolicy.fail_closed_class],
          sourceSurfacePolicy.reason,
          { app: "codex", role, subject, ...sourceSurfacePolicy.detail }
        );
      }
      if (
        codexRole === "worker" && input?.worker_scope_authority != null &&
        sourceSurfacePolicy.disposition
          === CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS.CALLABLE_SURFACE
      ) {
        return makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          "managed_worker_tool_profile_drift",
          { issue: "general_mcp_surface_forbidden", allowed_tools: ["commit"] }
        );
      }
      forwardedSourceToolSurface = sourceSurfacePolicy.forwardedSourceToolSurface;
    }

    if (delegatingToHostWriteAuthority) {
      let result;
      try {
        result = await hostWriteAuthority({
          ...input,
          codex_role: codexRole,

          source_tool_surface: forwardedSourceToolSurface,
          substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID
        });
      } catch (err) {
        return makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "host_write_authority_substrate_threw",
          {
            substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
            message: err?.message ?? String(err)
          }
        );
      }
      if (!result || typeof result !== "object") {
        return makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "host_write_authority_substrate_no_result",
          { substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID }
        );
      }
      return result;
    }

    const planCwd = workspaceDir ?? defaultCwd;

    const canonicalReviewerConfigRoot =
      codexRole === "review" &&
      typeof input?.config_root_dir === "string" &&
      input.config_root_dir.length > 0
        ? input.config_root_dir
        : null;
    let schemaConstrainedTierIsPaid;
    if (canonicalReviewerConfigRoot !== null) {
      if (!isReadableCanonicalConfigRoot(canonicalReviewerConfigRoot)) {
        return makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "reviewer_tier_config_root_unreadable",
          { config_root_dir: canonicalReviewerConfigRoot }
        );
      }

      const reviewerTierResolution = resolveSchemaConstrainedTierResolution({
        workspaceDir: canonicalReviewerConfigRoot
      });
      if (
        reviewerTierResolution.state ===
        LAUNCHER_SCHEMA_CONSTRAINED_TIER_STATES.READ_FAILURE
      ) {
        return makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "reviewer_tier_config_env_unreadable",
          { cause_code: reviewerTierResolution.cause_code }
        );
      }
      schemaConstrainedTierIsPaid = reviewerTierResolution.is_paid === true;
    } else {

      schemaConstrainedTierIsPaid = workspaceDir
        ? resolveSchemaConstrainedTier({ workspaceDir }) === true
        : false;
    }
    const terminalStructuredRoleResultMode = resolveCodexTerminalStructuredRoleResultMode({
      schemaConstrainedTierIsPaid,
      codexRole
    });

    let correctiveInstructions = null;
    try {
      correctiveInstructions = role === "worker"
        ? renderTrustedCorrectiveFindingsInstructions(
            input?.readiness?.trusted_corrective_findings_context ?? null,
            { subject }
          )
        : null;
    } catch (error) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "trusted_corrective_findings_context_invalid",
        { issue: error?.message ?? String(error) }
      );
    }
    const runtimeReadiness = input?.readiness && typeof input.readiness === "object" &&
      !Array.isArray(input.readiness)
      ? { ...input.readiness }
      : input?.readiness;
    if (runtimeReadiness && typeof runtimeReadiness === "object") {
      delete runtimeReadiness.trusted_corrective_findings_context;
    }
    const runtimeInput = runtimeReadiness === input?.readiness
      ? input
      : { ...input, readiness: runtimeReadiness };

    return launchCodexWorkspaceAgentInProcess({
      input: runtimeInput,
      role,
      subject,
      codexRole,
      promptArgs: correctiveInstructions === null
        ? promptArgs
        : [...promptArgs, correctiveInstructions],
      env,
      planCwd,
      effectiveResolvedProfile,
      workspaceAlias,
      workspaceDir,
      findingsOnlyAcceptance,
      forwardedSourceToolSurface,
      terminalStructuredRoleResultMode,
      buildPlan,
      buildBwrapPlan,
      ensureWriteRoots,
      assertBwrap,
      spawn,
      plainSpawn,
      captureFinalResult,
      killTimeoutMs,
      resolveUnsandboxedOptIn,
      classifyIsolationBackendAvailability,
      probeCanonicalBwrapAvailability
    });
  };
}
