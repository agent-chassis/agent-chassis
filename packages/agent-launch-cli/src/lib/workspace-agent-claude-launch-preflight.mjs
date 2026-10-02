import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { ensureLauncherRuntimeStateDir } from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import { isWithinRepo } from "./launch-isolation.mjs";
import { buildClaudeNativePermissionSettings } from "./workspace-agent-claude-launch-support.mjs";

import {
  BACKEND_REFUSAL_CODES
} from "./workspace-agent-dispatch-backend.mjs";
import {
  deriveDirectoryScopedWritableMountsFromWriteScope,
  deriveWritableMountsFromResolvedScope,
  assertDirectoryScopeWritableRootsSafe
} from "./workspace-agent-write-scope.mjs";
import {
  LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON
} from "./launcher-runtime-home-policy.mjs";
import {
  authenticateStdioMcpCompletionCredential,
  buildClaudeStdioMcpRegistrationArgs,
  createStdioMcpConduit
} from "./stdio-mcp-conduit.mjs";

export const CLAUDE_WORKSPACE_AGENT_MCP_CONDUIT_CONSTRUCTOR = createStdioMcpConduit;
import { loadWorkRecordById } from "@agent-chassis/wiki-core/src/lib/work-record-store.mjs";

import { resolveConfiguredAgentExecutable } from "@agent-chassis/agent-launch-core/src/lib/registry.mjs";

import { resolveLauncherSchemaConstrainedTierIsPaid } from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import {
  collectGitChangedPaths,
  verifyChangedFilesWithinWriteScope
} from "./workspace-agent-write-scope-verification.mjs";
import { spawnPlainChildProcess } from "./workspace-agent-claude-run-shaping.mjs";
import {
  mintTrustedStdioMcpConduitAuthority,
  resolveLauncherAgentSessionContract,
  resolveLauncherAgentSessionContractFacts
} from "./stdio-mcp-conduit-authority.mjs";
import {
  CLAUDE_APPROVED_CREDENTIALS_READ_ONLY_FILES,
  CLAUDE_CONFIGURED_EXECUTABLE_UNRESOLVABLE_REASON,
  CLAUDE_COMMAND_LINE_PROMPT_CONTRACT_INVALID_REASON,
  CLAUDE_FAMILY_NATIVE_REPO_WRITE_MECHANISM,
  CLAUDE_NATIVE_COMMAND_TOOL,
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
  probeClaudeRuntime,
  resolveConfiguredExecutable = resolveConfiguredAgentExecutable,
  workspaceDir = undefined,
  launcherTrustedPathEnv = null
}) {

  let configuredExecutable = null;
  let configuredLeadingArgs = [];
  if (typeof claudePath !== "string" || claudePath.length === 0) {
    try {
      ({ executable: configuredExecutable, leadingArgs: configuredLeadingArgs } =
        await resolveConfiguredExecutable({
          agentName: "claude",
          workspaceDir
        }));
    } catch (err) {
      return {
        refusal: makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          err?.code ?? CLAUDE_CONFIGURED_EXECUTABLE_UNRESOLVABLE_REASON,
          {
            fact: "claude_configured_executable",
            configuration_key: "agents.claude.base_argv[0]",
            message: err?.message ?? String(err),
            ...(err?.detail && typeof err.detail === "object" ? err.detail : {})
          }
        )
      };
    }
  }
  const injectedClaudePath = configuredExecutable === null;
  const runtimeFactsResult = resolveClaudeRuntimeFacts({
    readHostHome: readLauncherOwnedHostHome,
    configuredExecutable: configuredExecutable ?? claudePath,
    pathEnv: launcherTrustedPathEnv,
    preResolvedExecutable: injectedClaudePath
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
  const effectiveClaudePath = runtimeFacts.symlink;
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

  return {
    refusal: null,
    spawn,
    probe,
    resolvedClaudePath,

    configuredLeadingArgs: [...configuredLeadingArgs]
  };
}

export function isClaudeNativePermissionSettingsArtifact(settings) {
  return settings?.ok === true &&
    typeof settings.settingsPath === "string" && settings.settingsPath.length > 0 &&
    typeof settings.settingsRoot === "string" && settings.settingsRoot.length > 0;
}

export async function mintClaudeNativePermissionSurface({
  commandSurfaceRole,
  mintClaudeNativePermissionSettings,
  workspaceDir,
  writeScope,
  role,
  mcpToolNames,
  env
}) {
  if (!commandSurfaceRole) return { refusal: null, claudeSettings: null };
  const claudeSettings = await mintClaudeNativePermissionSettings({
    workspaceDir,
    writeScope,
    role,
    mcpToolNames,
    env
  });
  if (!isClaudeNativePermissionSettingsArtifact(claudeSettings)) {
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
  return { refusal: null, claudeSettings };
}

export function composeClaudeLaunchArgv({
  commandLine,
  conduit,
  mcpToolNames,
  commandSurfaceRole,

  configuredLeadingArgs = []
}) {
  const registrationArgs = conduit === null
    ? []
    : buildClaudeStdioMcpRegistrationArgs(
        conduit,
        mcpToolNames,
        commandSurfaceRole ? [CLAUDE_NATIVE_COMMAND_TOOL] : []
      );
  const optionArgs = Array.isArray(commandLine.optionArgs)
    ? [...configuredLeadingArgs, ...commandLine.optionArgs, ...registrationArgs]
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
  workerScopeAuthority = null,
  captureWriteScopeBaseline,
  mintWorkerScratchRoot,
  env
}) {

  if (needsDirectoryScope) {

    const derived = workerScopeAuthority === null
      ? deriveDirectoryScopedWritableMountsFromWriteScope({ workspaceDir, writeScope })
      : deriveWritableMountsFromResolvedScope({ workspaceDir, resolvedScope: workerScopeAuthority.resolved_scope });
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

function authenticateClaudeCompletionCredential({
  completionCredential,
  authority
}) {
  const contract = completionCredential ?? resolveLauncherAgentSessionContract(authority);
  return authenticateStdioMcpCompletionCredential({
    credential: contract,
    expectedFacts: resolveLauncherAgentSessionContractFacts(authority)
  });
}

export async function openClaudeStdioMcpConduit({
  createMcpConduit,
  role,
  subject,
  conduitWorkspaceDir,
  commitTuple,
  workerScopeAuthority,
  canonicalWriteScope,
  provisioning,
  completionCredential = null,
  completionTransport = null,
  canonicalRepo = null,
  workerAssignment = null,
  advisoryReviewInput = null
}) {
  const authority = mintTrustedStdioMcpConduitAuthority({
    family: "claude",
    role,
    assignedUnit: subject,
    workspaceDir: conduitWorkspaceDir,
    workerScopeAuthority,
    canonicalWriteScope,
    provisioning,
    commitTuple,

    workerAssignment,

    advisoryReviewInput
  });

  const authenticatedCompletionCredential = authenticateClaudeCompletionCredential({
    completionCredential,
    authority
  });
  const conduitInput = {
    family: "claude",
    role,
    assignedUnit: subject,
    workspaceDir: conduitWorkspaceDir,
    commitTuple,
    authority
  };

  conduitInput.sessionContract = authenticatedCompletionCredential;
  return await createMcpConduit(conduitInput);
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
  canonicalRepo,
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
      canonicalRepo,
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

    resolveSchemaConstrainedTier = resolveLauncherSchemaConstrainedTierIsPaid,

    verifyRuntimeIdentity = verifyClaudeRuntimeIdentityUnchanged,
    createMcpConduit = createStdioMcpConduit
  } = options;

  return {
    hasInjectedCredentialsReadOnlyFile,
    launchTransportInjected,
    probeClaudeRuntime, captureFinalResult, claudePath, resolveClaudeRuntimeFacts,
    readLauncherOwnedHostHome, buildCommandLine, promptForSubject, env, defaultCwd,
    buildBwrapPlan, spawnIsolated, plainSpawn, familyRuntimeReadOnlyRoots, killTimeoutMs,
    loadWorkRecord, credentialsReadOnlyFile, mintWorkerScratchRoot, nativeRepoWriteMechanism,
    verifyWorkerWriteScope, captureWriteScopeBaseline, mintClaudeNativePermissionSettings,
    resolveSchemaConstrainedTier, verifyRuntimeIdentity,
    createMcpConduit
  };
}

export const CLAUDE_NATIVE_PERMISSION_SETTINGS_UNAVAILABLE_REASON =
  "claude_native_permission_settings_unavailable";

const CLAUDE_NATIVE_PERMISSION_SETTINGS_DIRNAME = "claude-native-permission-settings";

export async function mintLauncherOwnedClaudeNativePermissionSettings({
  workspaceDir,
  writeScope = [],
  role = "worker",

  mcpToolNames = [],
  env = process.env,
  ensureRuntimeStateDir = ensureLauncherRuntimeStateDir,
  ensureSettingsBaseDir = (dir) => mkdir(dir, { recursive: true }),
  makeSettingsDir = mkdtemp,
  writeSettings = writeFile,
  buildSettings = buildClaudeNativePermissionSettings
} = {}) {
  let ensured;
  try {
    ensured = await ensureRuntimeStateDir({ workspaceDir, env });
  } catch (err) {
    return {
      ok: false,
      code: CLAUDE_NATIVE_PERMISSION_SETTINGS_UNAVAILABLE_REASON,
      reason: "launcher runtime-state dir probe threw while minting Claude native-permission settings",
      detail: { message: err?.message ?? String(err), code: err?.code ?? null }
    };
  }
  if (!ensured || ensured.ok !== true || typeof ensured.dir !== "string" || ensured.dir.length === 0) {
    return {
      ok: false,
      code: CLAUDE_NATIVE_PERMISSION_SETTINGS_UNAVAILABLE_REASON,
      reason: "launcher runtime-state dir unavailable; cannot mint Claude native-permission settings",
      detail: {
        runtime_state_code: ensured?.code ?? null,
        runtime_state_reason: ensured?.reason ?? null,
        runtime_state_dir: ensured?.dir ?? null
      }
    };
  }

  const settingsBase = path.join(ensured.dir, CLAUDE_NATIVE_PERMISSION_SETTINGS_DIRNAME);
  let settingsRoot;
  try {
    await ensureSettingsBaseDir(settingsBase);
    settingsRoot = await makeSettingsDir(path.join(settingsBase, "run-"));
    if (
      typeof workspaceDir === "string" &&
      workspaceDir.length > 0 &&
      isWithinRepo(settingsRoot, path.resolve(workspaceDir))
    ) {
      return {
        ok: false,
        code: CLAUDE_NATIVE_PERMISSION_SETTINGS_UNAVAILABLE_REASON,
        reason: "minted Claude native-permission settings resolved inside the repo write root",
        detail: { settingsRoot, workspaceDir }
      };
    }
    const settings = buildSettings({ workspaceDir, writeScope, role, mcpToolNames });
    const settingsPath = path.join(settingsRoot, "settings.json");
    await writeSettings(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    return { ok: true, settingsPath, settingsRoot, settings };
  } catch (err) {
    return {
      ok: false,
      code: CLAUDE_NATIVE_PERMISSION_SETTINGS_UNAVAILABLE_REASON,
      reason: "launcher could not mint Claude native-permission settings",
      detail: {
        settingsRoot: settingsRoot ?? null,
        message: err?.message ?? String(err),
        code: err?.code ?? null
      }
    };
  }
}
