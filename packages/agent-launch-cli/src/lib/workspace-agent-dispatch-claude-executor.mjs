

import {
  BACKEND_REFUSAL_CODES
} from "./workspace-agent-dispatch-backend.mjs";
import {
  BubblewrapIsolationError,
  spawnIsolated as defaultSpawnIsolated
} from "./launch-isolation.mjs";
import { loadWorkRecordById } from "@agent-chassis/wiki-core";

import { resolveLauncherSchemaConstrainedTierIsPaid } from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import {
  deriveDirectoryScopedWritableMountsFromWriteScope,
  assertDirectoryScopeWritableRootsSafe
} from "./workspace-agent-write-scope.mjs";
import {
  collectGitChangedPaths,
  verifyChangedFilesWithinWriteScope,
  WRITE_SCOPE_ENFORCEMENT_DIRECTORY_SCOPE,
  WRITE_SCOPE_VERIFICATION_REASONS,
  WRITE_SCOPE_VERIFICATION_SCHEMA_VERSION
} from "./workspace-agent-write-scope-verification.mjs";
import {
  __LAUNCH_CORE_TERMINAL_STATUSES_FOR_TESTS,
  superviseChildLaunch
} from "./workspace-agent-launch-core.mjs";
import { launchWorkspaceAgentFamilyLaunchLifecycle } from "./workspace-agent-family-launch-lifecycle.mjs";
import { HOST_WRITE_AUTHORITY_SUBSTRATE_ID } from "./host-write-authority-substrate.mjs";
import { resolveFindingsOnlyAcceptanceContract } from "./workspace-agent-findings-role-context.mjs";
import {
  LAUNCHER_WRITE_POSTURES
} from "./workspace-agent-family-policy.mjs";
import {
  LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON
} from "./launcher-runtime-home-policy.mjs";
import { planFamilyBrokerLaunch } from "./workspace-agent-broker-plan-policy.mjs";
import {
  WORKSPACE_AGENT_SANDBOX_OUTCOMES,
  buildWorkspaceAgentSandboxDecisionFromTrustedLegacyBwrapFacts
} from "./workspace-agent-sandbox-decision.mjs";
import {
  buildStructuredDispatchProvenance,
  createDispatchProvenanceEnforcementFromSandboxDecision
} from "./workspace-agent-dispatch-provenance.mjs";
import {
  delegateToHostWriteAuthority,
  attachDispatchProvenanceToSupervisedResult
} from "./workspace-agent-inprocess-launch-policy.mjs";
import {
  CLAUDE_APPROVED_CREDENTIALS_READ_ONLY_FILES,
  CLAUDE_FAMILY_NATIVE_REPO_WRITE_MECHANISM,
  CLAUDE_LAUNCH_EXECUTOR_MISSING_BACKEND_PATH,
  CLAUDE_LAUNCH_EXECUTOR_UNAVAILABLE_REASON,
  CLAUDE_NATIVE_PERMISSION_PROBE_UNPROVEN_REASON,
  CLAUDE_NATIVE_PERMISSION_SETTINGS_UNAVAILABLE_REASON,
  CLAUDE_RUNTIME_SETUP_REASONS,
  CLAUDE_WORKER_SCRATCH_UNAVAILABLE_REASON,
  buildUnavailableRefusal,
  createDefaultClaudeBwrapIsolatedSpawn,
  defaultBuildClaudeBwrapPlan,
  defaultBuildClaudeCommandLine,
  defaultCaptureClaudeFinalResult,
  defaultProbeClaudeRuntime,
  defaultReadLauncherOwnedHostHome,
  isClaudeCredentialsReadOnlyFileRefusal,
  makeRefusal,
  mintClaudeWorkerScratchRoot,
  mintLauncherOwnedClaudeNativePermissionSettings,
  probeClaudeNativePermissionEnforcement,
  resolveCanonicalWriteScope,
  resolveClaudeLauncherRoleWritePosture,
  resolveClaudeLauncherWriteScope,
  resolveLauncherOwnedClaudeRuntimeFacts
} from "./workspace-agent-claude-launch-support.mjs";

async function spawnPlainChildProcess(command, args, options) {
  const childProcess = await import("node:" + "child_process");
  return childProcess.spawn(command, Array.isArray(args) ? [...args] : [], options);
}

function buildClaudeChildRunProvenance({
  enforcement = null,
  sandboxDecision = null
} = {}) {
  const effectiveEnforcement = sandboxDecision
    ? createDispatchProvenanceEnforcementFromSandboxDecision(sandboxDecision)
    : enforcement;
  return buildStructuredDispatchProvenance({
    transcriptSource: "child_process_stdout",
    enforcement: effectiveEnforcement,
    artifacts: []
  });
}

function buildClaudeSupervisedFinalResultWithProvenance(provenanceContext) {
  return (finalResult) => ({
    ...finalResult,
    provenance: buildClaudeChildRunProvenance(provenanceContext)
  });
}

function buildClaudeWriteScopeVerificationFailure(detail) {
  return Object.freeze({
    schema_version: WRITE_SCOPE_VERIFICATION_SCHEMA_VERSION,
    ran: false,
    ok: false,
    reason: WRITE_SCOPE_VERIFICATION_REASONS.CHECK_THREW,
    enforcement: WRITE_SCOPE_ENFORCEMENT_DIRECTORY_SCOPE,
    detail,
    changed: Object.freeze([]),
    out_of_scope: Object.freeze([])
  });
}

function bwrapAvailabilityFromClaudeIsolationError(err) {
  return Object.freeze({
    available: false,
    diagnostic: Object.freeze({
      code: err?.code ?? null,
      message: err?.message ?? "Claude isolation backend failed before spawn",
      detail: err?.detail ?? null
    })
  });
}

function buildClaudeSandboxDecisionFromIsolationFailure({
  err,
  launchFacts,
  role,
  subject,
  workspaceDir
}) {
  return buildWorkspaceAgentSandboxDecisionFromTrustedLegacyBwrapFacts({
    launchFacts,
    role,
    subject,
    workspaceDir,
    bwrapAvailability: bwrapAvailabilityFromClaudeIsolationError(err),
    source: "claude_executor_late_bwrap_failure"
  });
}

function buildClaudeSandboxDecisionRefusal(decision) {
  return makeRefusal(
    BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
    decision?.refusal?.reason ?? "claude_sandbox_decision_refused",
    decision?.refusal?.detail ?? null
  );
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

    hostWriteAuthority = null,

    credentialsReadOnlyFile = null,

    mintWorkerScratchRoot = mintClaudeWorkerScratchRoot,

    nativeRepoWriteMechanism = CLAUDE_FAMILY_NATIVE_REPO_WRITE_MECHANISM,
    verifyWorkerWriteScope = verifyChangedFilesWithinWriteScope,
    captureWriteScopeBaseline = collectGitChangedPaths,

    mintClaudeNativePermissionSettings = mintLauncherOwnedClaudeNativePermissionSettings,
    verifyNativePermissionEnforcement = probeClaudeNativePermissionEnforcement,

    resolveSchemaConstrainedTier = resolveLauncherSchemaConstrainedTierIsPaid
  } = options;

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

    const runtimeFactsResult = resolveClaudeRuntimeFacts({
      readHostHome: readLauncherOwnedHostHome
    });
    if (!runtimeFactsResult || runtimeFactsResult.ok !== true) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        runtimeFactsResult?.reason ?? LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON,
        runtimeFactsResult?.detail ?? { fact: "claude_launcher_owned_host_home" }
      );
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
      return buildUnavailableRefusal(
        CLAUDE_RUNTIME_SETUP_REASONS.PROBE_THREW,
        { symlink_path: effectiveClaudePath },
        {
          probe_error: {
            message: err?.message ?? String(err),
            code: err?.code ?? null
          }
        }
      );
    }
    if (!probe || typeof probe !== "object") {
      return buildUnavailableRefusal(
        CLAUDE_RUNTIME_SETUP_REASONS.PROBE_INVALID_RESULT,
        { symlink_path: effectiveClaudePath },
        { probe_result_type: probe === null ? "null" : typeof probe }
      );
    }
    if (probe.available !== true) {
      const reasonDetail = typeof probe.reason === "string" && probe.reason.length > 0
        ? probe.reason
        : CLAUDE_RUNTIME_SETUP_REASONS.PATH_UNREADABLE;
      return buildUnavailableRefusal(reasonDetail, probe.detail ?? { symlink_path: effectiveClaudePath });
    }

    const resolvedClaudePath = typeof probe.detail?.symlink_path === "string" && probe.detail.symlink_path.length > 0
      ? probe.detail.symlink_path
      : effectiveClaudePath;

    if (typeof hostWriteAuthority === "function") {
      return delegateToHostWriteAuthority({
        invoke: () => hostWriteAuthority({
          ...input,
          substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID
        }),
        onThrew: (err) => makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "host_write_authority_substrate_threw",
          {
            substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
            message: err?.message ?? String(err)
          }
        ),
        onMissingResult: () => makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "host_write_authority_substrate_no_result",
          { substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID }
        )
      });
    }

    const prompt = typeof promptForSubject === "function"
      ? promptForSubject({ role, subject, workspaceDir })
      : null;

    const requestedModel = typeof input?.model === "string" && input.model.length > 0
      ? input.model
      : null;

    const writePosture = resolveClaudeLauncherRoleWritePosture(role);

    const writeScopeGate = resolveClaudeLauncherWriteScope({
      role,
      writeScope: await resolveCanonicalWriteScope({ subject, workspaceDir, loadWorkRecord })
    });
    const wsr = writeScopeGate.refusal;
    if (wsr) return makeRefusal(wsr.code, wsr.reason, wsr.detail);
    const writeScope = writeScopeGate.writeScope;

    const isNativeEditWriteScopeWorker =
      writePosture.ok === true &&
      writePosture.posture === LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE &&
      nativeRepoWriteMechanism === true;

    let claudeSettings = null;
    if (isNativeEditWriteScopeWorker) {
      claudeSettings = await mintClaudeNativePermissionSettings({ workspaceDir, writeScope, env });
      if (
        !claudeSettings ||
        claudeSettings.ok !== true ||
        typeof claudeSettings.settingsPath !== "string" ||
        typeof claudeSettings.settingsRoot !== "string"
      ) {
        return makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          claudeSettings?.code ?? CLAUDE_NATIVE_PERMISSION_SETTINGS_UNAVAILABLE_REASON,
          {
            reason: claudeSettings?.reason ?? "launcher Claude native-permission settings unavailable",
            ...(claudeSettings?.detail ?? {})
          }
        );
      }

      if (nativePermissionProbeExplicitlyInjected || !launchTransportInjected) {
        const enforcementProof = await verifyNativePermissionEnforcement({
          claudePath: resolvedClaudePath,
          env
        });
        if (!enforcementProof || enforcementProof.ok !== true) {
          return makeRefusal(
            BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
            enforcementProof?.reason ?? CLAUDE_NATIVE_PERMISSION_PROBE_UNPROVEN_REASON,
            { app: "claude", probe: enforcementProof?.detail ?? enforcementProof?.checks ?? null }
          );
        }
      }
    }

    const schemaConstrainedTerminalResult = workspaceDir
      ? resolveSchemaConstrainedTier({ workspaceDir }) === true
      : false;

    let commandLine;
    try {

      const findingsOnlyAcceptance = await resolveFindingsOnlyAcceptanceContract({
        role,
        subject,
        workspaceDir,
        loadWorkRecord,

        frozenReviewContract: input?.trusted_frozen_review_contract ?? null
      });
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
        schemaConstrainedTerminalResult
      });
    } catch (err) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "claude_command_line_build_threw",
        { message: err?.message ?? String(err) }
      );
    }
    if (!commandLine || typeof commandLine !== "object" || typeof commandLine.command !== "string" || commandLine.command.length === 0) {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "claude_command_line_invalid",
        { received_type: typeof commandLine }
      );
    }
    const argv = Array.isArray(commandLine.args) ? commandLine.args : [];

    const hasAssignedWriteScope =
      writePosture.ok === true &&
      writePosture.posture === LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE &&
      Array.isArray(writeScope) &&
      writeScope.length > 0;
    const needsDirectoryScope = hasAssignedWriteScope && nativeRepoWriteMechanism === true;
    let runtimeRoots = [];

    const readOnlyRoots = claudeSettings?.settingsRoot ? [claudeSettings.settingsRoot] : [];

    let writeScopeBaseline = null;
    if (needsDirectoryScope) {
      const derived = deriveDirectoryScopedWritableMountsFromWriteScope({ workspaceDir, writeScope });
      const guard = assertDirectoryScopeWritableRootsSafe({
        workspaceDir,
        writableRoots: derived.writableRoots
      });
      if (!guard.ok) {
        return makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          guard.reason ?? "claude_directory_scope_mount_unsafe",
          guard.detail ?? null
        );
      }
      try {
        writeScopeBaseline = captureWriteScopeBaseline({ workspaceDir });
      } catch {

        writeScopeBaseline = null;
      }
    } else if (hasAssignedWriteScope) {
      const scratch = await mintWorkerScratchRoot({ workspaceDir, env });
      if (!scratch || scratch.ok !== true || typeof scratch.scratchRoot !== "string") {
        return makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          scratch?.code ?? CLAUDE_WORKER_SCRATCH_UNAVAILABLE_REASON,
          {
            reason: scratch?.reason ?? "launcher worker scratch unavailable",
            ...(scratch?.detail ?? {})
          }
        );
      }
      runtimeRoots = [...runtimeRoots, scratch.scratchRoot];
    }

    let child;
    try {
      child = spawn(commandLine.command, argv, {
        env,
        cwd: workspaceDir ?? defaultCwd,

        writeScope,

        runtimeRoots,
        readOnlyRoots,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      if (isClaudeCredentialsReadOnlyFileRefusal(err)) {
        return makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          "claude_executor_credentials_path_invalid",
          err.detail ?? null
        );
      }
      if (err instanceof BubblewrapIsolationError) {
        const planCwd = workspaceDir ?? defaultCwd;
        const sandboxDecision = buildClaudeSandboxDecisionFromIsolationFailure({
          err,
          launchFacts: {
            command: commandLine.command,
            args: argv,
            cwd: planCwd,
            env
          },
          role,
          subject,
          workspaceDir: planCwd
        });
        if (
          sandboxDecision?.outcome
            === WORKSPACE_AGENT_SANDBOX_OUTCOMES.UNENFORCED_PLAIN_LAUNCH
        ) {

          const plainLaunch = sandboxDecision.plain_launch;
          return launchWorkspaceAgentFamilyLaunchLifecycle({
            command: plainLaunch.command,
            args: plainLaunch.args,
            cwd: plainLaunch.cwd,
            env: plainLaunch.env,
            options: {
              stdio: ["ignore", "pipe", "pipe"],
              detached: false
            },
            spawn: plainSpawn,
            superviseChildLaunch,
            parseFinalResult: ({ status, exit, stdout, stderr }) =>
              captureFinalResult({
                status,
                exit,
                role,
                subject,
                capturedStdout: stdout,
                capturedStderr: stderr,
                claudePath: resolvedClaudePath,
                workspaceDir
              }),
            role,
            subject,
            kind: "claude",
            killTimeoutMs,
            passthrough: { claudePath: resolvedClaudePath, workspaceDir },
            warning: sandboxDecision.warning,
            enforcement: sandboxDecision.enforcement,
            buildSpawnThrewRefusal: (detail) =>
              makeRefusal(
                BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
                "plain_spawn_threw",
                detail
              ),
            buildNoChildRefusal: () =>
              makeRefusal(
                BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
                "plain_spawn_no_child",
                null
              ),
            postRunVerification: needsDirectoryScope
              ? {
                  run: () => {
                    try {
                      return verifyWorkerWriteScope({ workspaceDir, writeScope, baseline: writeScopeBaseline });
                    } catch (verificationErr) {
                      return buildClaudeWriteScopeVerificationFailure({
                        message: verificationErr?.message ?? String(verificationErr)
                      });
                    }
                  },
                  finalResultField: "write_scope_verification"
                }
              : null,
            adaptSupervisedResult: (supervised) =>
              attachDispatchProvenanceToSupervisedResult(
                supervised,
                buildClaudeSupervisedFinalResultWithProvenance({ sandboxDecision })
              )
          });
        }
        return buildClaudeSandboxDecisionRefusal(sandboxDecision);
      }
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "claude_spawn_threw",
        { message: err?.message ?? String(err), code: err?.code ?? null }
      );
    }

    return launchWorkspaceAgentFamilyLaunchLifecycle({
      command: commandLine.command,
      args: argv,
      spawn: () => child,
      superviseChildLaunch,
      parseFinalResult: ({ status, exit, stdout, stderr }) =>
        captureFinalResult({
          status,
          exit,
          role,
          subject,
          capturedStdout: stdout,
          capturedStderr: stderr,
          claudePath: resolvedClaudePath,
          workspaceDir
        }),
      role,
      subject,
      kind: "claude",
      killTimeoutMs,
      passthrough: { claudePath: resolvedClaudePath, workspaceDir },
      buildSpawnThrewRefusal: (detail) =>
        makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "claude_spawn_threw",
          { ...detail, code: null }
        ),
      buildNoChildRefusal: () =>
        makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "claude_spawn_no_child",
          null
        ),
      postRunVerification: needsDirectoryScope
        ? {
            run: () => {
              try {
                return verifyWorkerWriteScope({ workspaceDir, writeScope, baseline: writeScopeBaseline });
              } catch (err) {
                return buildClaudeWriteScopeVerificationFailure({
                  message: err?.message ?? String(err)
                });
              }
            },
            finalResultField: "write_scope_verification"
          }
        : null
    });
  };
}

export const __TERMINAL_STATUSES_FOR_TESTS = __LAUNCH_CORE_TERMINAL_STATUSES_FOR_TESTS;

export function createHostWriteAuthorityBrokerClaudePlanLaunch({
  probeClaudeRuntime = defaultProbeClaudeRuntime,
  buildCommandLine = defaultBuildClaudeCommandLine,
  buildBwrapPlan = defaultBuildClaudeBwrapPlan,
  claudePath = null,
  resolveClaudeRuntimeFacts = resolveLauncherOwnedClaudeRuntimeFacts,
  readLauncherOwnedHostHome = defaultReadLauncherOwnedHostHome,
  env = process.env,
  captureFinalResult = defaultCaptureClaudeFinalResult,
  loadWorkRecord = loadWorkRecordById,

  credentialsReadOnlyFile = null,

  mintClaudeNativePermissionSettings = mintLauncherOwnedClaudeNativePermissionSettings,
  verifyNativePermissionEnforcement = probeClaudeNativePermissionEnforcement,

  resolveSchemaConstrainedTier = resolveLauncherSchemaConstrainedTierIsPaid
} = {}) {
  const brokerArgs = arguments.length > 0 ? arguments[0] ?? {} : {};
  const hasInjectedCredentialsReadOnlyFile =
    Object.prototype.hasOwnProperty.call(brokerArgs, "credentialsReadOnlyFile");

  const brokerProbeExplicitlyInjected =
    Object.prototype.hasOwnProperty.call(brokerArgs, "verifyNativePermissionEnforcement");
  const brokerLaunchTransportInjected =
    Object.prototype.hasOwnProperty.call(brokerArgs, "buildBwrapPlan");

  return async function claudeBrokerPlanLaunch(launchInput) {
    const requestedModel = typeof launchInput?.model === "string" && launchInput.model.length > 0
      ? launchInput.model
      : null;

    const brokerWorkspaceDir =
      typeof launchInput?.workspace_dir === "string" && launchInput.workspace_dir.length > 0
        ? launchInput.workspace_dir
        : null;
    const schemaConstrainedTerminalResult = brokerWorkspaceDir
      ? resolveSchemaConstrainedTier({ workspaceDir: brokerWorkspaceDir }) === true
      : false;
    const runtimeFactsResult = resolveClaudeRuntimeFacts({
      readHostHome: readLauncherOwnedHostHome
    });
    if (!runtimeFactsResult || runtimeFactsResult.ok !== true) {
      return {
        ok: false,
        refusal: {
          reason: runtimeFactsResult?.reason ?? LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON,
          detail: runtimeFactsResult?.detail ?? { fact: "claude_launcher_owned_host_home" }
        }
      };
    }
    const runtimeFacts = runtimeFactsResult.facts;
    const effectiveClaudePath = typeof claudePath === "string" && claudePath.length > 0
      ? claudePath
      : runtimeFacts.symlink;
    const effectiveCredentialsReadOnlyFile = hasInjectedCredentialsReadOnlyFile
      ? credentialsReadOnlyFile
      : runtimeFacts.credentialsFile;
    const effectiveApprovedCredentialsReadOnlyFiles = hasInjectedCredentialsReadOnlyFile
      ? CLAUDE_APPROVED_CREDENTIALS_READ_ONLY_FILES
      : [runtimeFacts.credentialsFile];
    return planFamilyBrokerLaunch({
      app: "claude",
      env,
      launchInput,

      parseFinalResult: ({ status, exit, plan, stdout, stderr }) =>
        captureFinalResult({
          status,
          exit,
          role: plan?.role ?? null,
          subject: plan?.subject ?? null,
          capturedStdout: stdout ?? null,
          capturedStderr: stderr ?? null
        }),

      mapStepError: (stage, err) => {
        if (stage === "command") {
          return {
            reason: "claude_broker_command_line_build_threw",
            detail: { app: "claude", message: err?.message ?? String(err) }
          };
        }
        if (stage === "bwrap") {
          return {
            reason: "claude_broker_bwrap_plan_threw",
            detail: { app: "claude", message: err?.message ?? String(err), code: err?.code ?? null }
          };
        }
        return null;
      },
      steps: {

        write_scope: async (ctx) => {
          const writeScopeGate = resolveClaudeLauncherWriteScope({
            role: ctx.role,
            writeScope: await resolveCanonicalWriteScope({
              subject: ctx.subject,
              workspaceDir: ctx.workspaceDir,
              loadWorkRecord
            })
          });
          if (writeScopeGate.refusal) {
            return { refusal: { reason: writeScopeGate.refusal.reason, detail: writeScopeGate.refusal.detail } };
          }
          return { writeScope: writeScopeGate.writeScope };
        },

        probe: async () => {
          let probe;
          try {
            probe = await probeClaudeRuntime({ claudePath: effectiveClaudePath });
          } catch (err) {
            return {
              refusal: {
                reason: CLAUDE_LAUNCH_EXECUTOR_UNAVAILABLE_REASON,
                detail: {
                  app: "claude",
                  missing_backend: CLAUDE_LAUNCH_EXECUTOR_MISSING_BACKEND_PATH,
                  reason_detail: CLAUDE_RUNTIME_SETUP_REASONS.PROBE_THREW,
                  probe: { symlink_path: effectiveClaudePath },
                  probe_error: { message: err?.message ?? String(err), code: err?.code ?? null }
                }
              }
            };
          }
          if (!probe || typeof probe !== "object" || probe.available !== true) {
            return {
              refusal: {
                reason: CLAUDE_LAUNCH_EXECUTOR_UNAVAILABLE_REASON,
                detail: {
                  app: "claude",
                  missing_backend: CLAUDE_LAUNCH_EXECUTOR_MISSING_BACKEND_PATH,
                  reason_detail: probe?.reason ?? CLAUDE_RUNTIME_SETUP_REASONS.PATH_UNREADABLE,
                  probe: probe?.detail ?? { symlink_path: effectiveClaudePath }
                }
              }
            };
          }
          return { resolvedClaudePath: probe.detail?.symlink_path ?? effectiveClaudePath };
        },

        command: async (ctx) => {

          let claudeSettings = null;
          const writePosture = resolveClaudeLauncherRoleWritePosture(ctx.role);
          if (
            writePosture.ok === true &&
            writePosture.posture === LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE &&
            CLAUDE_FAMILY_NATIVE_REPO_WRITE_MECHANISM === true
          ) {
            claudeSettings = await mintClaudeNativePermissionSettings({
              workspaceDir: ctx.workspaceDir,
              writeScope: Array.isArray(ctx.writeScope) ? ctx.writeScope : [],
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
                  reason: claudeSettings?.code ?? CLAUDE_NATIVE_PERMISSION_SETTINGS_UNAVAILABLE_REASON,
                  detail: {
                    app: "claude",
                    code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
                    reason: claudeSettings?.reason ?? "launcher Claude native-permission settings unavailable",
                    ...(claudeSettings?.detail ?? {})
                  }
                }
              };
            }
            if (brokerProbeExplicitlyInjected || !brokerLaunchTransportInjected) {
              const enforcementProof = await verifyNativePermissionEnforcement({
                claudePath: ctx.resolvedClaudePath,
                env
              });
              if (!enforcementProof || enforcementProof.ok !== true) {
                return {
                  refusal: {
                    reason: enforcementProof?.reason ?? CLAUDE_NATIVE_PERMISSION_PROBE_UNPROVEN_REASON,
                    detail: {
                      app: "claude",
                      code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
                      probe: enforcementProof?.detail ?? enforcementProof?.checks ?? null
                    }
                  }
                };
              }
            }
          }
          const findingsOnlyAcceptance = await resolveFindingsOnlyAcceptanceContract({
            role: ctx.role,
            subject: ctx.subject,
            workspaceDir: ctx.workspaceDir,
            loadWorkRecord,

            frozenReviewContract: ctx?.launchInput?.trusted_frozen_review_contract ?? null
          });
          const commandLine = buildCommandLine({
            claudePath: ctx.resolvedClaudePath,
            role: ctx.role,
            subject: ctx.subject,
            prompt: null,
            model: requestedModel,
            workspaceDir: ctx.workspaceDir,
            acceptanceCriteria: findingsOnlyAcceptance?.acceptanceCriteria ?? [],
            acceptanceValidation: findingsOnlyAcceptance?.acceptanceValidation ?? [],
            claudeSettingsPath: claudeSettings?.settingsPath ?? null,
            schemaConstrainedTerminalResult
          });
          return {
            command: commandLine.command,
            args: Array.isArray(commandLine.args) ? commandLine.args : [],
            readOnlyRoots: claudeSettings?.settingsRoot ? [claudeSettings.settingsRoot] : []
          };
        },

        bwrap: (ctx) => {
          const bwrapPlan = buildBwrapPlan({
            command: ctx.command,
            args: Array.isArray(ctx.args) ? ctx.args : [],
            workspaceDir: ctx.workspaceDir,
            env,
            writeScope: ctx.writeScope,
            runtimeRoots: Array.isArray(ctx.runtimeRoots) ? ctx.runtimeRoots : [],
            readOnlyRoots: Array.isArray(ctx.readOnlyRoots) ? ctx.readOnlyRoots : [],
            credentialsReadOnlyFile: effectiveCredentialsReadOnlyFile,
            approvedCredentialsReadOnlyFiles: effectiveApprovedCredentialsReadOnlyFiles,
            familyRuntimeReadOnlyRoots: [runtimeFacts.readOnlyRoot],
            familyRuntimePolicyProfile: runtimeFacts.familyRuntimePolicyProfile
          });
          return { bwrapPlan };
        }
      }
    });
  };
}
