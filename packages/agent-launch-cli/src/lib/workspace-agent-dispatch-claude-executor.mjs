

import path from "node:path";

import { spawnIsolated as defaultSpawnIsolated } from "./launch-isolation.mjs";
import { defaultBuildClaudeBwrapPlan } from "./workspace-agent-claude-launch-support.mjs";
import {
  BACKEND_REFUSAL_CODES
} from "./workspace-agent-dispatch-backend.mjs";
import { resolveLauncherRoleToolNames } from "./launcher-role-tool-profile.mjs";
import { assertFrozenWorkerScopeAuthority } from "./workspace-agent-launch-core.mjs";
import { assertCodexWorkerCommitCredentialBinding } from "./codex-role-mcp-env.mjs";
import { __LAUNCH_CORE_TERMINAL_STATUSES_FOR_TESTS } from "./workspace-agent-launch-core.mjs";
import {
  FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
  resolveFindingsOnlyAcceptanceContract
} from "./workspace-agent-findings-role-context.mjs";
import {
  LAUNCHER_WRITE_POSTURES
} from "./workspace-agent-family-policy.mjs";
import {
  buildClaudeLaunchCommandLine,
  resolveClaudeExecutorSeams,
  composeClaudeLaunchArgv,
  mintClaudeNativePermissionSurface,
  openClaudeStdioMcpConduit,
  resolveClaudeRuntimePreflight,
  resolveClaudeWritePathMounts
} from "./workspace-agent-claude-launch-preflight.mjs";
export { resolvePlainChildProcessSpawn } from "./workspace-agent-claude-run-shaping.mjs";
import {
  resolveClaudeSpawnFailureOutcome,
  settleClaudeSupervisedLaunch
} from "./workspace-agent-claude-launch-outcome.mjs";
export { CLAUDE_EXACT_SLICE_REVIEW_SANDBOX_REQUIRED_REASON } from "./workspace-agent-claude-launch-outcome.mjs";
import {
  CLAUDE_LAUNCH_EXECUTOR_MISSING_BACKEND_PATH,
  CLAUDE_LAUNCH_EXECUTOR_UNAVAILABLE_REASON,
  CLAUDE_RUNTIME_SETUP_REASONS,
  makeRefusal,
  resolveCanonicalWriteScope,
  resolveClaudeLauncherRoleWritePosture,
  resolveClaudeLauncherWriteScope
} from "./workspace-agent-claude-launch-support.mjs";
import {
  renderTrustedCorrectiveFindingsInstructions
} from "./workspace-agent-launch-adapter-contract.mjs";

export const CLAUDE_WORKER_SCOPE_AUTHORITY_INVALID_REASON =
  "claude_worker_scope_authority_invalid";

function isLauncherOwnedExactSliceReview(input, { role, subject } = {}) {
  const contract = input?.trusted_frozen_review_contract ??
    input?.readiness?.trusted_frozen_review_contract;
  const target = input?.readiness?.frozen_slice_review_target;
  return role === "reviewer" &&
    contract !== null && typeof contract === "object" && !Array.isArray(contract) &&
    Object.keys(contract).sort().join("\0") === [
      "canonical_parent_wk_contract", "review_subject", "review_unit_contract", "schema_version"
    ].sort().join("\0") &&
    contract.schema_version === FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION &&
    contract.review_subject === subject &&
    typeof contract.canonical_parent_wk_contract === "string" &&
    typeof contract.review_unit_contract === "string" &&
    target !== null && typeof target === "object" && !Array.isArray(target) &&
    target.slice_level_review === true &&
    typeof target.ref === "string" &&
    typeof target.sha === "string" &&
    typeof target.diff_base_sha === "string" &&
    typeof (input?.config_root_dir ?? input?.readiness?.config_root_dir) === "string" &&
    typeof input?.workspace_dir === "string" &&
    (input.config_root_dir ?? input.readiness.config_root_dir) !== input.workspace_dir;
}

export {
  CLAUDE_BWRAP_ENV_ALLOWLIST,
  CLAUDE_BWRAP_ENV_POLICY,
  CLAUDE_CREDENTIALS_READ_ONLY_FILE,
  CLAUDE_FAMILY_NATIVE_READ_CAPABILITY,
  CLAUDE_FAMILY_NATIVE_REPO_WRITE_MECHANISM,
  CLAUDE_FAMILY_RUNTIME_READ_ONLY_ROOTS,
  CLAUDE_FAMILY_SOURCE_READ_MODE,
  CLAUDE_FINAL_MESSAGE_FINDINGS_SCHEMA_VERSION,
  CLAUDE_LAUNCH_EXECUTOR_MISSING_BACKEND_PATH,
  CLAUDE_LAUNCH_EXECUTOR_UNAVAILABLE_REASON,
  CLAUDE_NATIVE_PERMISSION_PROBE_UNPROVEN_REASON,
  CLAUDE_NATIVE_PERMISSION_SETTINGS_UNAVAILABLE_REASON,
  CLAUDE_RUNTIME_SETUP_REASONS,
  CLAUDE_WORKER_DENY_TOOLS,
  CLAUDE_WORKER_DISALLOWED_NATIVE_WRITE_TOOLS,
  CLAUDE_WORKER_SCRATCH_DIRNAME,
  CLAUDE_WORKER_SCRATCH_UNAVAILABLE_REASON,
  CLAUDE_WORKSPACE_AGENT_LAUNCH_EXECUTOR_SCHEMA_VERSION,
  DEFAULT_CLAUDE_RUNTIME_SYMLINK,
  buildClaudeEffortArgs,
  buildClaudeNativePermissionSettings,
  createDefaultClaudeBwrapIsolatedSpawn,
  defaultBuildClaudeBwrapPlan,
  defaultBuildClaudeCommandLine,
  defaultCaptureClaudeFinalResult,
  defaultProbeClaudeRuntime,
  deriveClaudeEditAllowPatterns,
  deriveClaudeSettingsMaskDirs,
  deriveClaudeWritableMountsFromWriteScope,
  deriveLauncherOwnedClaudeRuntimeFacts,
  deriveLauncherOwnedHostHome,
  mintClaudeWorkerScratchRoot,
  mintLauncherOwnedClaudeNativePermissionSettings,
  probeClaudeNativePermissionEnforcement,
  resolveCanonicalWriteScope,
  resolveLauncherOwnedClaudeRuntimeFacts
} from "./workspace-agent-claude-launch-support.mjs";

export function createClaudeWorkspaceAgentLaunchExecutor(options = {}) {
  const {
    hasInjectedCredentialsReadOnlyFile,
    nativePermissionProbeExplicitlyInjected,
    launchTransportInjected,
    probeClaudeRuntime, captureFinalResult, claudePath, resolveClaudeRuntimeFacts,
    readLauncherOwnedHostHome, buildCommandLine, promptForSubject, env, defaultCwd,
    buildBwrapPlan, spawnIsolated, plainSpawn, familyRuntimeReadOnlyRoots, killTimeoutMs,
    loadWorkRecord, credentialsReadOnlyFile, mintWorkerScratchRoot, nativeRepoWriteMechanism,
    verifyWorkerWriteScope, captureWriteScopeBaseline, mintClaudeNativePermissionSettings,
    verifyNativePermissionEnforcement, resolveSchemaConstrainedTier, verifyRuntimeIdentity,
    createMcpConduit
  } = resolveClaudeExecutorSeams(options, {
    defaultSpawnIsolated,
    defaultBuildClaudeBwrapPlan
  });

  return async function claudeLaunchExecutor(input) {
    const role = typeof input?.role === "string" && input.role.length > 0
      ? input.role
      : null;
    const subject = typeof input?.subject === "string" && input.subject.length > 0
      ? input.subject
      : null;
    const workspaceDir = typeof input?.workspace_dir === "string" && input.workspace_dir.length > 0
      ? input.workspace_dir
      : null;

    if (role === null) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "claude_executor_role_required",
        { role: input?.role ?? null }
      );
    }
    if (subject === null) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        "claude_executor_subject_required",
        { subject: input?.subject ?? null }
      );
    }

    const runtimePreflight = await resolveClaudeRuntimePreflight({
      options,
      resolveClaudeRuntimeFacts,
      readLauncherOwnedHostHome,
      claudePath,
      familyRuntimeReadOnlyRoots,
      hasInjectedCredentialsReadOnlyFile,
      credentialsReadOnlyFile,
      buildBwrapPlan,
      spawnIsolated,
      probeClaudeRuntime
    });
    if (runtimePreflight.refusal) return runtimePreflight.refusal;
    const { spawn, probe, resolvedClaudePath } = runtimePreflight;

    const prompt = typeof promptForSubject === "function"
      ? promptForSubject({ role, subject, workspaceDir })
      : null;

    const requestedModel = typeof input?.model === "string" && input.model.length > 0
      ? input.model
      : null;

    const writePosture = resolveClaudeLauncherRoleWritePosture(role);

    const launcherOwnedExactSliceReview = isLauncherOwnedExactSliceReview(input, { role, subject });
    const writeScopeGate = resolveClaudeLauncherWriteScope({
      role,
      writeScope: await resolveCanonicalWriteScope({
        subject,
        workspaceDir: launcherOwnedExactSliceReview
          ? (input.config_root_dir ?? input.readiness.config_root_dir)
          : workspaceDir,
        loadWorkRecord
      }),
      launcherOwnedExactSliceReview
    });
    const wsr = writeScopeGate.refusal;
    if (wsr) return makeRefusal(wsr.code, wsr.reason, wsr.detail);
    const writeScope = writeScopeGate.writeScope;

    const provisioning = input?.worktree_provisioning ?? null;
    const managedImplementationWorker = role === "worker" && provisioning !== null;

    const effectiveNativeRepoWriteMechanism =
      nativeRepoWriteMechanism === true && !managedImplementationWorker;

    let workerScopeAuthority = null;
    try {
      workerScopeAuthority = assertFrozenWorkerScopeAuthority(
        input?.worker_scope_authority ?? null,
        {
          role,
          subject,
          worktreeProvisioning: provisioning,
          provisionedWorktreeGitBinding:
            input?.provisionedWorktreeGitBinding ?? input?.provisioned_worktree_git_binding ?? null,
          required: managedImplementationWorker
        }
      );
    } catch (err) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        err?.code ?? CLAUDE_WORKER_SCOPE_AUTHORITY_INVALID_REASON,
        { message: err?.message ?? String(err), role, subject }
      );
    }
    if (managedImplementationWorker && workerScopeAuthority === null) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        CLAUDE_WORKER_SCOPE_AUTHORITY_INVALID_REASON,
        { message: "managed Claude implementation worker requires a frozen scope authority", subject }
      );
    }

    let conduit = null;
    const conduitRequired =
      !launchTransportInjected || Object.prototype.hasOwnProperty.call(options, "createMcpConduit");

    const refuseAfterConduit = async (code, reason, detail) => {
      let conduitCleanupFailures = null;
      if (conduit) {
        try {
          await conduit.cleanup();
        } catch (cleanupError) {
          conduitCleanupFailures = cleanupError?.detail
            ?? { message: cleanupError?.message ?? String(cleanupError) };
        }
      }
      return makeRefusal(code, reason, {
        ...(detail ?? {}),
        ...(conduitCleanupFailures === null
          ? {}
          : { conduit_cleanup_failures: conduitCleanupFailures })
      });
    };
    if (conduitRequired) {
      try {
        const commitTuple = role === "worker" && provisioning !== null
          ? assertCodexWorkerCommitCredentialBinding({
              assignedUnit: subject,
              managedWorker: true,
              worktreeProvisioning: provisioning,
              sliceBinding: provisioning.slice_binding
            })
          : null;
        conduit = await openClaudeStdioMcpConduit({
          createMcpConduit,
          role,
          subject,
          conduitWorkspaceDir:
            provisioning?.main_repo ?? path.resolve(workspaceDir ?? defaultCwd),
          commitTuple,
          workerScopeAuthority: role === "worker" ? workerScopeAuthority : null,

          canonicalWriteScope: role === "worker" && workerScopeAuthority === null
            ? writeScope ?? []
            : null,
          provisioning
        });
      } catch (err) {
        return await refuseAfterConduit(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          err?.code ?? "claude_stdio_mcp_conduit_failed",
          { message: err?.message ?? String(err), detail: err?.detail ?? null }
        );
      }
    }

    const mcpToolNames = conduit?.toolNames ?? resolveLauncherRoleToolNames(role);

    const commandSurfaceRole = role === "worker" || role === "reviewer";
    const permissionSurface = await mintClaudeNativePermissionSurface({
      commandSurfaceRole,
      mintClaudeNativePermissionSettings,
      verifyNativePermissionEnforcement,
      nativePermissionProbeExplicitlyInjected,
      launchTransportInjected,
      workspaceDir,
      writeScope,
      role,
      mcpToolNames,
      env,
      resolvedClaudePath
    });
    if (permissionSurface.refusal) {
      const r = permissionSurface.refusal;
      return await refuseAfterConduit(r.code, r.reason, r.detail);
    }
    const claudeSettings = permissionSurface.claudeSettings;

    const schemaConstrainedTerminalResult = workspaceDir
      ? resolveSchemaConstrainedTier({ workspaceDir }) === true
      : false;

    const correctiveInstructions = role === "worker"
      ? renderTrustedCorrectiveFindingsInstructions(
          input?.readiness?.trusted_corrective_findings_context ?? null,
          { subject }
        )
      : null;

    const findingsOnlyAcceptance = await resolveFindingsOnlyAcceptanceContract({
      role,
      subject,
      workspaceDir,
      loadWorkRecord,

      frozenReviewContract: input?.trusted_frozen_review_contract ??
        input?.readiness?.trusted_frozen_review_contract ?? null
    });
    const commandLineResult = buildClaudeLaunchCommandLine({
      buildCommandLine,
      resolvedClaudePath,
      role,
      subject,
      prompt,
      requestedModel,
      workspaceDir,
      probe,
      findingsOnlyAcceptance,
      claudeSettings,
      effectiveNativeRepoWriteMechanism,
      schemaConstrainedTerminalResult,
      correctiveInstructions
    });
    if (commandLineResult.refusal) {
      const r = commandLineResult.refusal;
      return await refuseAfterConduit(r.code, r.reason, r.detail);
    }
    const commandLine = commandLineResult.commandLine;

    const argvComposition = composeClaudeLaunchArgv({
      commandLine,
      conduit,
      mcpToolNames,
      commandSurfaceRole
    });
    if (argvComposition.refusal) {
      const r = argvComposition.refusal;
      return await refuseAfterConduit(r.code, r.reason, r.detail);
    }
    const argv = argvComposition.argv;

    const hasAssignedWriteScope =
      writePosture.ok === true &&
      writePosture.posture === LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE &&
      Array.isArray(writeScope) &&
      writeScope.length > 0;
    const needsDirectoryScope = hasAssignedWriteScope && effectiveNativeRepoWriteMechanism;

    const readOnlyRoots = [
      ...(claudeSettings?.settingsRoot ? [claudeSettings.settingsRoot] : []),
      ...(role === "reviewer" && Array.isArray(input?.reviewer_dependency_binds)
        ? input.reviewer_dependency_binds
        : [])
    ];
    const writePathMounts = await resolveClaudeWritePathMounts({
      needsDirectoryScope,
      hasAssignedWriteScope,
      workspaceDir,
      writeScope,
      captureWriteScopeBaseline,
      mintWorkerScratchRoot,
      env
    });
    if (writePathMounts.refusal) {
      const r = writePathMounts.refusal;
      return await refuseAfterConduit(r.code, r.reason, r.detail);
    }
    const runtimeRoots = writePathMounts.runtimeRoots;
    const writeScopeBaseline = writePathMounts.writeScopeBaseline;

    const identityCheck = await verifyRuntimeIdentity({
      claudePath: resolvedClaudePath,
      identity: probe.detail?.runtime_identity ?? null
    });
    if (identityCheck?.ok !== true) {
      return await refuseAfterConduit(
        BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
        CLAUDE_LAUNCH_EXECUTOR_UNAVAILABLE_REASON,
        {
          app: "claude",
          missing_backend: CLAUDE_LAUNCH_EXECUTOR_MISSING_BACKEND_PATH,
          reason_detail: identityCheck?.reason ?? CLAUDE_RUNTIME_SETUP_REASONS.TARGET_REPLACED,
          probe: identityCheck?.detail ?? null
        }
      );
    }

    const terminalReviewSpawnBarrier =
      typeof input?.terminal_review_spawn_barrier === "function"
        ? input.terminal_review_spawn_barrier
        : null;
    if (terminalReviewSpawnBarrier !== null) {
      const verdict = terminalReviewSpawnBarrier();
      if (verdict?.ok !== true) {
        return await refuseAfterConduit(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          verdict?.reason ?? "terminal_review_attempt_contract_recheck_failed",
          { role, subject, ...(verdict?.detail ?? {}) }
        );
      }
    }

    const launchOutcomeContext = {
      role,
      subject,
      conduit,
      refuseAfterConduit,
      launcherOwnedExactSliceReview,
      commandLine,
      argv,
      env,
      workspaceDir,
      defaultCwd,
      plainSpawn,
      captureFinalResult,
      resolvedClaudePath,
      killTimeoutMs,
      terminalReviewSpawnBarrier,
      needsDirectoryScope,
      verifyWorkerWriteScope,
      writeScope,
      writeScopeBaseline
    };

    let child;
    try {
      child = spawn(commandLine.command, argv, {
        env,
        cwd: workspaceDir ?? defaultCwd,

        writeScope,

        workerScopeAuthority,
        nativeRepoWriteMechanism: effectiveNativeRepoWriteMechanism,

        runtimeRoots,
        readOnlyRoots,
        findingsRole: role === "reviewer" || role === "redteam" ? role : null,
        credentialsWritable: launcherOwnedExactSliceReview !== true,
        stdioMcpConduit: conduit,
        stdio: ["ignore", "pipe", "pipe"],

        terminalReviewSpawnBarrier
      });
    } catch (err) {
      return await resolveClaudeSpawnFailureOutcome(err, launchOutcomeContext);
    }
    return await settleClaudeSupervisedLaunch({ ...launchOutcomeContext, child });
  };
}

export const __TERMINAL_STATUSES_FOR_TESTS = __LAUNCH_CORE_TERMINAL_STATUSES_FOR_TESTS;
