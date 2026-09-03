

import path from "node:path";

import { spawnIsolated as defaultSpawnIsolated } from "./launch-isolation.mjs";
import { defaultBuildClaudeBwrapPlan } from "./workspace-agent-claude-launch-support.mjs";
import {
  BACKEND_REFUSAL_CODES
} from "./workspace-agent-dispatch-backend.mjs";
import {
  resolveTerminalStructuredRoleResultMode
} from "@agent-chassis/agent-launch-core/src/lib/work-record-launch-prompt.mjs";
import { resolveLauncherRoleToolNames } from "./launcher-role-tool-profile.mjs";
import { assertFrozenWorkerScopeAuthority } from "./workspace-agent-launch-core.mjs";
import { assertCodexWorkerCommitCredentialBinding } from "./codex-role-mcp-env.mjs";
import { __LAUNCH_CORE_TERMINAL_STATUSES_FOR_TESTS } from "./workspace-agent-launch-core.mjs";
import {
  consumeAdvisoryReviewInput,
  renderFamilyNeutralAdvisoryReviewInput
} from "./workspace-agent-advisory-review-contract.mjs";
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
  attachLauncherObservedTerminalResultModeFacts
} from "./workspace-agent-dispatch-result-mode.mjs";
import { selectWorkerLifecycleFromEffectiveWriteScope } from
  "./workspace-agent-worker-lifecycle.mjs";

export const CLAUDE_WORKER_SCOPE_AUTHORITY_INVALID_REASON =
  "claude_worker_scope_authority_invalid";

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
    let advisoryReviewInput = null;
    if (input?.advisory_review_input !== undefined) {
      try {
        advisoryReviewInput = consumeAdvisoryReviewInput(input.advisory_review_input,
          { role, subject });
      } catch {
        return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          "advisory_review_input_invalid", { role, subject });
      }
    }
    let lifecycleKind = "advisory";
    if (advisoryReviewInput === null) {
      if (role !== "worker") {
        return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          "advisory_review_input_required", { role, subject });
      }
      try {
        lifecycleKind = selectWorkerLifecycleFromEffectiveWriteScope(
          input?.canonical_unit_write_scope
        );
      } catch (error) {
        return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          error?.code ?? "launcher_effective_write_scope_invalid",
          { subject, authority_limb: "mechanical_failure" });
      }
      if (lifecycleKind !== "implementation") {
        return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          "worker_implementation_lifecycle_required", { role, subject });
      }
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

    const prompt = advisoryReviewInput === null
      ? (typeof promptForSubject === "function"
          ? promptForSubject({ role, subject, workspaceDir })
          : null)
      : renderFamilyNeutralAdvisoryReviewInput(advisoryReviewInput);

    const requestedModel = typeof input?.model === "string" && input.model.length > 0
      ? input.model
      : null;

    const writePosture = resolveClaudeLauncherRoleWritePosture(role);

    const writeScopeGate = resolveClaudeLauncherWriteScope({
      role,
      writeScope: advisoryReviewInput !== null
        ? []
        : await resolveCanonicalWriteScope({ subject, workspaceDir, loadWorkRecord })
    });
    const wsr = writeScopeGate.refusal;
    if (wsr) return makeRefusal(wsr.code, wsr.reason, wsr.detail);
    const writeScope = writeScopeGate.writeScope;

    const provisioning = input?.worktree_provisioning ?? null;
    const serverProvisionedWorktreeGitBinding =
      input?.provisionedWorktreeGitBinding ?? input?.provisioned_worktree_git_binding ?? null;
    const managedImplementationWorker =
      lifecycleKind === "implementation" && provisioning !== null;
    const advisoryExecution = advisoryReviewInput !== null;
    const canonicalRepo = advisoryReviewInput?.repository ?? null;

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
            serverProvisionedWorktreeGitBinding,
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

          conduitWorkspaceDir: advisoryExecution
            ? canonicalRepo
            : provisioning?.main_repo ?? path.resolve(workspaceDir ?? defaultCwd),
          commitTuple,
          workerScopeAuthority: role === "worker" ? workerScopeAuthority : null,

          canonicalWriteScope: lifecycleKind === "implementation" &&
              workerScopeAuthority === null
            ? writeScope ?? []
            : null,
          provisioning,

          completionCredential: input?.completion_credential ?? null,
          completionTransport: input?.completion_transport ?? null,
          canonicalRepo: advisoryExecution ? canonicalRepo : null
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

    const schemaConstrainedTerminalResult = advisoryReviewInput !== null
      ? advisoryReviewInput.formal_result_contract?.mode === "schema_constrained"
      : workspaceDir
        ? resolveSchemaConstrainedTier({ workspaceDir }) === true
        : false;
    const terminalStructuredRoleResultMode = resolveTerminalStructuredRoleResultMode({
      schemaConstrained: schemaConstrainedTerminalResult,
      role
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
      canonicalRepo: advisoryExecution ? canonicalRepo : null,
      claudeSettings,
      effectiveNativeRepoWriteMechanism,
      schemaConstrainedTerminalResult,
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
      ...(advisoryExecution ? [advisoryReviewInput.private_checkout_root] : [])
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

    const launchOutcomeContext = {
      role,
      subject,
      conduit,
      refuseAfterConduit,
      commandLine,
      argv,
      env,
      workspaceDir,
      defaultCwd,
      plainSpawn,
      captureFinalResult,
      resolvedClaudePath,
      killTimeoutMs,
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
        protectGitMetadata: advisoryExecution,
        provisionedWorktreeGitBinding: serverProvisionedWorktreeGitBinding,
        credentialsWritable: !advisoryExecution,
        stdioMcpConduit: conduit,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      return await resolveClaudeSpawnFailureOutcome(err, launchOutcomeContext);
    }
    const launchResult = await settleClaudeSupervisedLaunch({ ...launchOutcomeContext, child });
    return launchResult?.accepted === true
      ? attachLauncherObservedTerminalResultModeFacts(
          launchResult,
          { selectedContract: terminalStructuredRoleResultMode }
        )
      : launchResult;
  };
}

export const __TERMINAL_STATUSES_FOR_TESTS = __LAUNCH_CORE_TERMINAL_STATUSES_FOR_TESTS;
