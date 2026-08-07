

import {
  BACKEND_REFUSAL_CODES
} from "./workspace-agent-dispatch-backend.mjs";
import {
  deriveDirectoryScopedWritableMountsFromWriteScope,
  assertDirectoryScopeWritableRootsSafe
} from "./workspace-agent-write-scope.mjs";
import {
  LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON
} from "./launcher-runtime-home-policy.mjs";
import {
  buildClaudeStdioMcpRegistrationArgs,
  createStdioMcpConduit
} from "./stdio-mcp-conduit.mjs";
import { loadWorkRecordById } from "@agent-chassis/wiki-core";

import { resolveLauncherSchemaConstrainedTierIsPaid } from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import {
  collectGitChangedPaths,
  verifyChangedFilesWithinWriteScope
} from "./workspace-agent-write-scope-verification.mjs";
import { spawnPlainChildProcess } from "./workspace-agent-claude-run-shaping.mjs";
import {
  mintTrustedStdioMcpConduitAuthority
} from "./stdio-mcp-conduit-authority.mjs";
import {
  CLAUDE_APPROVED_CREDENTIALS_READ_ONLY_FILES,
  CLAUDE_COMMAND_LINE_PROMPT_CONTRACT_INVALID_REASON,
  CLAUDE_FAMILY_NATIVE_REPO_WRITE_MECHANISM,
  CLAUDE_NATIVE_COMMAND_TOOL,
  CLAUDE_NATIVE_PERMISSION_PROBE_UNPROVEN_REASON,
  CLAUDE_NATIVE_PERMISSION_SETTINGS_UNAVAILABLE_REASON,
  CLAUDE_RUNTIME_SETUP_REASONS,
  CLAUDE_WORKER_SCRATCH_UNAVAILABLE_REASON,
  buildUnavailableRefusal,
  composeClaudeArgv,
  createDefaultClaudeBwrapIsolatedSpawn,
  defaultBuildClaudeCommandLine,
  defaultCaptureClaudeFinalResult,
  defaultProbeClaudeRuntime,
  defaultReadLauncherOwnedHostHome,
  makeRefusal,
  mintClaudeWorkerScratchRoot,
  mintLauncherOwnedClaudeNativePermissionSettings,
  probeClaudeNativePermissionEnforcement,
  resolveLauncherOwnedClaudeRuntimeFacts,
  verifyClaudeArgvPromptContract,
  verifyClaudeRuntimeIdentityUnchanged
} from "./workspace-agent-claude-launch-support.mjs";

export async function resolveClaudeRuntimePreflight({
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
}) {
  const runtimeFactsResult = resolveClaudeRuntimeFacts({
    readHostHome: readLauncherOwnedHostHome
  });
  if (!runtimeFactsResult || runtimeFactsResult.ok !== true) {
    return {
      refusal: makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        runtimeFactsResult?.reason ?? LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON,
        runtimeFactsResult?.detail ?? { fact: "claude_launcher_owned_host_home" }
      )
    };
  }
  const runtimeFacts = runtimeFactsResult.facts;
  const effectiveClaudePath = typeof claudePath === "string" && claudePath.length > 0
    ? claudePath
    : runtimeFacts.symlink;
  const effectiveFamilyRuntimeReadOnlyRoots = Array.isArray(familyRuntimeReadOnlyRoots)
    ? familyRuntimeReadOnlyRoots
    : Object.freeze([runtimeFacts.readOnlyRoot]);
  const effectiveCredentialsReadOnlyFile = hasInjectedCredentialsReadOnlyFile
    ? credentialsReadOnlyFile
    : runtimeFacts.credentialsFile;
  const effectiveApprovedCredentialsReadOnlyFiles = hasInjectedCredentialsReadOnlyFile
    ? CLAUDE_APPROVED_CREDENTIALS_READ_ONLY_FILES
    : [runtimeFacts.credentialsFile];
  const effectiveFamilyRuntimePolicyProfile = runtimeFacts.familyRuntimePolicyProfile;
  const spawn = options.spawn ?? createDefaultClaudeBwrapIsolatedSpawn({
    buildBwrapPlan,
    spawnIsolated,
    familyRuntimeReadOnlyRoots: effectiveFamilyRuntimeReadOnlyRoots,
    credentialsReadOnlyFile: effectiveCredentialsReadOnlyFile,
    approvedCredentialsReadOnlyFiles: effectiveApprovedCredentialsReadOnlyFiles,
    familyRuntimePolicyProfile: effectiveFamilyRuntimePolicyProfile
  });

  let probe;
  try {
    probe = await probeClaudeRuntime({ claudePath: effectiveClaudePath });
  } catch (err) {
    return {
      refusal: buildUnavailableRefusal(
        CLAUDE_RUNTIME_SETUP_REASONS.PROBE_THREW,
        { symlink_path: effectiveClaudePath },
        {
          probe_error: {
            message: err?.message ?? String(err),
            code: err?.code ?? null
          }
        }
      )
    };
  }
  if (!probe || typeof probe !== "object") {
    return {
      refusal: buildUnavailableRefusal(
        CLAUDE_RUNTIME_SETUP_REASONS.PROBE_INVALID_RESULT,
        { symlink_path: effectiveClaudePath },
        { probe_result_type: probe === null ? "null" : typeof probe }
      )
    };
  }
  if (probe.available !== true) {
    const reasonDetail = typeof probe.reason === "string" && probe.reason.length > 0
      ? probe.reason
      : CLAUDE_RUNTIME_SETUP_REASONS.PATH_UNREADABLE;
    return {
      refusal: buildUnavailableRefusal(
        reasonDetail,
        probe.detail ?? { symlink_path: effectiveClaudePath }
      )
    };
  }

  const resolvedClaudePath = typeof probe.detail?.symlink_path === "string" && probe.detail.symlink_path.length > 0
    ? probe.detail.symlink_path
    : effectiveClaudePath;

  return { refusal: null, spawn, probe, resolvedClaudePath };
}

export async function mintClaudeNativePermissionSurface({
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
}) {
  if (!commandSurfaceRole) return { refusal: null, claudeSettings: null };
  const claudeSettings = await mintClaudeNativePermissionSettings({
    workspaceDir,
    writeScope,
    role,
    mcpToolNames,
    env
  });
  if (
    !claudeSettings ||
    claudeSettings.ok !== true ||
    typeof claudeSettings.settingsPath !== "string" ||
    typeof claudeSettings.settingsRoot !== "string"
  ) {
    return {
      refusal: {
        code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        reason: claudeSettings?.code ?? CLAUDE_NATIVE_PERMISSION_SETTINGS_UNAVAILABLE_REASON,
        detail: {
          reason: claudeSettings?.reason ?? "launcher Claude native-permission settings unavailable",
          ...(claudeSettings?.detail ?? {})
        }
      },
      claudeSettings: null
    };
  }

  if (nativePermissionProbeExplicitlyInjected || !launchTransportInjected) {
    const enforcementProof = await verifyNativePermissionEnforcement({
      claudePath: resolvedClaudePath,
      env
    });
    if (!enforcementProof || enforcementProof.ok !== true) {
      return {
        refusal: {
          code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          reason: enforcementProof?.reason ?? CLAUDE_NATIVE_PERMISSION_PROBE_UNPROVEN_REASON,
          detail: { app: "claude", probe: enforcementProof?.detail ?? enforcementProof?.checks ?? null }
        },
        claudeSettings: null
      };
    }
  }
  return { refusal: null, claudeSettings };
}

export function composeClaudeLaunchArgv({
  commandLine,
  conduit,
  mcpToolNames,
  commandSurfaceRole
}) {
  const registrationArgs = conduit === null
    ? []
    : buildClaudeStdioMcpRegistrationArgs(
        conduit,
        mcpToolNames,
        commandSurfaceRole ? [CLAUDE_NATIVE_COMMAND_TOOL] : []
      );
  const optionArgs = Array.isArray(commandLine.optionArgs)
    ? [...commandLine.optionArgs, ...registrationArgs]
    : null;
  if (optionArgs === null || typeof commandLine.prompt !== "string") {
    return {
      refusal: {
        code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        reason: CLAUDE_COMMAND_LINE_PROMPT_CONTRACT_INVALID_REASON,
        detail: {
          contract: commandLine.commandLineContract ?? null,
          cause: "structured_command_line_contract_missing",
          option_args_present: Array.isArray(commandLine.optionArgs),
          prompt_present: typeof commandLine.prompt === "string"
        }
      },
      argv: null
    };
  }
  const argv = composeClaudeArgv({ optionArgs, prompt: commandLine.prompt });
  const argvContract = verifyClaudeArgvPromptContract({ argv, prompt: commandLine.prompt });
  if (!argvContract.ok) {
    return {
      refusal: {
        code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        reason: CLAUDE_COMMAND_LINE_PROMPT_CONTRACT_INVALID_REASON,
        detail: { contract: commandLine.commandLineContract ?? null, ...argvContract.detail }
      },
      argv: null
    };
  }
  return { refusal: null, argv };
}

export async function resolveClaudeWritePathMounts({
  needsDirectoryScope,
  hasAssignedWriteScope,
  workspaceDir,
  writeScope,
  captureWriteScopeBaseline,
  mintWorkerScratchRoot,
  env
}) {

  if (needsDirectoryScope) {
    const derived = deriveDirectoryScopedWritableMountsFromWriteScope({ workspaceDir, writeScope });
    const guard = assertDirectoryScopeWritableRootsSafe({
      workspaceDir,
      writableRoots: derived.writableRoots
    });
    if (!guard.ok) {
      return {
        refusal: {
          code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          reason: guard.reason ?? "claude_directory_scope_mount_unsafe",
          detail: guard.detail ?? null
        },
        runtimeRoots: [],
        writeScopeBaseline: null
      };
    }
    let writeScopeBaseline = null;
    try {
      writeScopeBaseline = captureWriteScopeBaseline({ workspaceDir });
    } catch {

      writeScopeBaseline = null;
    }
    return { refusal: null, runtimeRoots: [], writeScopeBaseline };
  }
  if (hasAssignedWriteScope) {
    const scratch = await mintWorkerScratchRoot({ workspaceDir, env });
    if (!scratch || scratch.ok !== true || typeof scratch.scratchRoot !== "string") {
      return {
        refusal: {
          code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          reason: scratch?.code ?? CLAUDE_WORKER_SCRATCH_UNAVAILABLE_REASON,
          detail: {
            reason: scratch?.reason ?? "launcher worker scratch unavailable",
            ...(scratch?.detail ?? {})
          }
        },
        runtimeRoots: [],
        writeScopeBaseline: null
      };
    }
    return { refusal: null, runtimeRoots: [scratch.scratchRoot], writeScopeBaseline: null };
  }
  return { refusal: null, runtimeRoots: [], writeScopeBaseline: null };
}

export async function openClaudeStdioMcpConduit({
  createMcpConduit,
  role,
  subject,
  conduitWorkspaceDir,
  commitTuple,
  workerScopeAuthority,
  canonicalWriteScope,
  provisioning
}) {
  const authority = mintTrustedStdioMcpConduitAuthority({
    family: "claude",
    role,
    assignedUnit: subject,
    workspaceDir: conduitWorkspaceDir,
    workerScopeAuthority,
    canonicalWriteScope,
    provisioning,
    commitTuple
  });
  return await createMcpConduit({
    family: "claude",
    role,
    assignedUnit: subject,
    workspaceDir: conduitWorkspaceDir,
    commitTuple,
    authority
  });
}

export function buildClaudeLaunchCommandLine({
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
}) {
  let commandLine;
  try {
    commandLine = buildCommandLine({
      claudePath: resolvedClaudePath,
      role,
      subject,
      prompt,
      model: requestedModel,
      workspaceDir,
      probe: probe.detail ?? null,
      acceptanceCriteria: findingsOnlyAcceptance?.acceptanceCriteria ?? [],
      acceptanceValidation: findingsOnlyAcceptance?.acceptanceValidation ?? [],
      claudeSettingsPath: claudeSettings?.settingsPath ?? null,
      nativeRepoWriteMechanism: effectiveNativeRepoWriteMechanism,
      schemaConstrainedTerminalResult,
      supplementalInstructions: correctiveInstructions
    });
  } catch (err) {
    return {
      refusal: {
        code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        reason: "claude_command_line_build_threw",
        detail: { message: err?.message ?? String(err) }
      },
      commandLine: null
    };
  }
  if (!commandLine || typeof commandLine !== "object" || typeof commandLine.command !== "string" || commandLine.command.length === 0) {
    return {
      refusal: {
        code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        reason: "claude_command_line_invalid",
        detail: { received_type: typeof commandLine }
      },
      commandLine: null
    };
  }
  return { refusal: null, commandLine };
}

export function resolveClaudeExecutorSeams(options, {
  defaultSpawnIsolated,
  defaultBuildClaudeBwrapPlan
}) {
  const hasInjectedCredentialsReadOnlyFile =
    Object.prototype.hasOwnProperty.call(options, "credentialsReadOnlyFile");

  const nativePermissionProbeExplicitlyInjected =
    Object.prototype.hasOwnProperty.call(options, "verifyNativePermissionEnforcement");
  const launchTransportInjected =
    Object.prototype.hasOwnProperty.call(options, "spawn") ||
    Object.prototype.hasOwnProperty.call(options, "spawnIsolated") ||
    Object.prototype.hasOwnProperty.call(options, "buildBwrapPlan");
  const {
    probeClaudeRuntime = defaultProbeClaudeRuntime,
    captureFinalResult = defaultCaptureClaudeFinalResult,
    claudePath = null,
    resolveClaudeRuntimeFacts = resolveLauncherOwnedClaudeRuntimeFacts,
    readLauncherOwnedHostHome = defaultReadLauncherOwnedHostHome,
    buildCommandLine = defaultBuildClaudeCommandLine,
    promptForSubject = null,
    env = process.env,
    cwd: defaultCwd = process.cwd(),

    buildBwrapPlan = defaultBuildClaudeBwrapPlan,
    spawnIsolated = defaultSpawnIsolated,
    plainSpawn = spawnPlainChildProcess,
    familyRuntimeReadOnlyRoots = null,

    killTimeoutMs = null,
    loadWorkRecord = loadWorkRecordById,

    credentialsReadOnlyFile = null,

    mintWorkerScratchRoot = mintClaudeWorkerScratchRoot,

    nativeRepoWriteMechanism = CLAUDE_FAMILY_NATIVE_REPO_WRITE_MECHANISM,
    verifyWorkerWriteScope = verifyChangedFilesWithinWriteScope,
    captureWriteScopeBaseline = collectGitChangedPaths,

    mintClaudeNativePermissionSettings = mintLauncherOwnedClaudeNativePermissionSettings,
    verifyNativePermissionEnforcement = probeClaudeNativePermissionEnforcement,

    resolveSchemaConstrainedTier = resolveLauncherSchemaConstrainedTierIsPaid,

    verifyRuntimeIdentity = verifyClaudeRuntimeIdentityUnchanged,
    createMcpConduit = createStdioMcpConduit
  } = options;

  return {
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
  };
}
