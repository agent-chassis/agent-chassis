

import path from "node:path";
import {
  BACKEND_REFUSAL_CODES
} from "./workspace-agent-dispatch-backend.mjs";
import {
  BubblewrapIsolationError,
  spawnIsolated as defaultSpawnIsolated
} from "./launch-isolation.mjs";
import {
  buildClaudeStdioMcpRegistrationArgs,
  createStdioMcpConduit
} from "./stdio-mcp-conduit.mjs";
import {
  STDIO_MCP_CONDUIT_REQUIRES_BUBBLEWRAP_REASON,
  STDIO_MCP_CONDUIT_RUN_TIMEOUT_MS,
  attachStdioMcpConduitLaunchOutcome,
  settleStdioMcpConduitCleanup
} from "./stdio-mcp-conduit-contract.mjs";
import {
  mintTrustedStdioMcpConduitAuthority
} from "./stdio-mcp-conduit-authority.mjs";
import { resolveLauncherRoleToolNames } from "./launcher-role-tool-profile.mjs";
import { assertFrozenWorkerScopeAuthority } from "./workspace-agent-launch-core.mjs";
import { assertCodexWorkerCommitCredentialBinding } from "./codex-role-mcp-env.mjs";
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
import {
  FROZEN_SLICE_LEVEL_ACCEPTANCE_CONTRACT_SCHEMA_VERSION,
  resolveFindingsOnlyAcceptanceContract
} from "./workspace-agent-findings-role-context.mjs";
import {
  LAUNCHER_WRITE_POSTURES
} from "./workspace-agent-family-policy.mjs";
import {
  LAUNCHER_RUNTIME_HOME_FACT_RESOLUTION_REASON
} from "./launcher-runtime-home-policy.mjs";
import {
  WORKSPACE_AGENT_SANDBOX_OUTCOMES,
  buildWorkspaceAgentSandboxDecisionFromTrustedLegacyBwrapFacts
} from "./workspace-agent-sandbox-decision.mjs";
import {
  buildStructuredDispatchProvenance,
  createDispatchProvenanceEnforcementFromSandboxDecision,
  createLauncherObservedDispatchEnforcementForConfirmedIsolatedSpawn
} from "./workspace-agent-dispatch-provenance.mjs";
import { attachDispatchProvenanceToSupervisedResult } from "./workspace-agent-inprocess-launch-policy.mjs";
import {
  CLAUDE_APPROVED_CREDENTIALS_READ_ONLY_FILES,
  CLAUDE_COMMAND_LINE_PROMPT_CONTRACT_INVALID_REASON,
  CLAUDE_FAMILY_NATIVE_REPO_WRITE_MECHANISM,
  composeClaudeArgv,
  verifyClaudeArgvPromptContract,
  CLAUDE_LAUNCH_EXECUTOR_MISSING_BACKEND_PATH,
  CLAUDE_LAUNCH_EXECUTOR_UNAVAILABLE_REASON,
  CLAUDE_NATIVE_COMMAND_TOOL,
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
  resolveLauncherOwnedClaudeRuntimeFacts,
  verifyClaudeRuntimeIdentityUnchanged
} from "./workspace-agent-claude-launch-support.mjs";
import {
  renderTrustedCorrectiveFindingsInstructions
} from "./workspace-agent-launch-adapter-contract.mjs";

export const CLAUDE_EXACT_SLICE_REVIEW_SANDBOX_REQUIRED_REASON =
  "claude_exact_slice_review_sandbox_required";

export const CLAUDE_WORKER_SCOPE_AUTHORITY_INVALID_REASON =
  "claude_worker_scope_authority_invalid";

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

function buildClaudeSupervisedFinalResultWithProvenance(provenanceContext) {
  const decorated = new WeakMap();
  return (finalResult) => {
    if (!finalResult || typeof finalResult !== "object") {
      return finalResult;
    }
    const cached = decorated.get(finalResult);
    if (cached !== undefined) {
      return cached;
    }
    const next = {
      ...finalResult,
      provenance: buildClaudeChildRunProvenance(provenanceContext)
    };
    decorated.set(finalResult, next);
    return next;
  };
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

        const conduitWorkspaceDir =
          provisioning?.main_repo ?? path.resolve(workspaceDir ?? defaultCwd);
        const authority = mintTrustedStdioMcpConduitAuthority({
          family: "claude",
          role,
          assignedUnit: subject,
          workspaceDir: conduitWorkspaceDir,
          workerScopeAuthority: role === "worker" ? workerScopeAuthority : null,

          canonicalWriteScope: role === "worker" && workerScopeAuthority === null
            ? writeScope ?? []
            : null,
          provisioning,
          commitTuple
        });
        conduit = await createMcpConduit({
          family: "claude",
          role,
          assignedUnit: subject,
          workspaceDir: conduitWorkspaceDir,
          commitTuple,
          authority
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

    let claudeSettings = null;
    const commandSurfaceRole = role === "worker" || role === "reviewer";
    if (commandSurfaceRole) {
      claudeSettings = await mintClaudeNativePermissionSettings({
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
        return await refuseAfterConduit(
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
          return await refuseAfterConduit(
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
      return await refuseAfterConduit(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "claude_command_line_build_threw",
        { message: err?.message ?? String(err) }
      );
    }
    if (!commandLine || typeof commandLine !== "object" || typeof commandLine.command !== "string" || commandLine.command.length === 0) {
      return await refuseAfterConduit(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "claude_command_line_invalid",
        { received_type: typeof commandLine }
      );
    }

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
      return await refuseAfterConduit(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        CLAUDE_COMMAND_LINE_PROMPT_CONTRACT_INVALID_REASON,
        {
          contract: commandLine.commandLineContract ?? null,
          cause: "structured_command_line_contract_missing",
          option_args_present: Array.isArray(commandLine.optionArgs),
          prompt_present: typeof commandLine.prompt === "string"
        }
      );
    }
    const argv = composeClaudeArgv({ optionArgs, prompt: commandLine.prompt });
    const argvContract = verifyClaudeArgvPromptContract({ argv, prompt: commandLine.prompt });
    if (!argvContract.ok) {
      return await refuseAfterConduit(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        CLAUDE_COMMAND_LINE_PROMPT_CONTRACT_INVALID_REASON,
        { contract: commandLine.commandLineContract ?? null, ...argvContract.detail }
      );
    }

    const hasAssignedWriteScope =
      writePosture.ok === true &&
      writePosture.posture === LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE &&
      Array.isArray(writeScope) &&
      writeScope.length > 0;
    const needsDirectoryScope = hasAssignedWriteScope && effectiveNativeRepoWriteMechanism;
    let runtimeRoots = [];

    const readOnlyRoots = [
      ...(claudeSettings?.settingsRoot ? [claudeSettings.settingsRoot] : []),
      ...(role === "reviewer" && Array.isArray(input?.reviewer_dependency_binds)
        ? input.reviewer_dependency_binds
        : [])
    ];

    let writeScopeBaseline = null;
    if (needsDirectoryScope) {
      const derived = deriveDirectoryScopedWritableMountsFromWriteScope({ workspaceDir, writeScope });
      const guard = assertDirectoryScopeWritableRootsSafe({
        workspaceDir,
        writableRoots: derived.writableRoots
      });
      if (!guard.ok) {
        return await refuseAfterConduit(
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
        return await refuseAfterConduit(
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
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      if (conduit) {

        let conduitCleanupDetail = null;
        try {
          await conduit.cleanup();
        } catch (cleanupError) {
          conduitCleanupDetail = cleanupError?.detail
            ?? { message: cleanupError?.message ?? null };
        }
        return makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          STDIO_MCP_CONDUIT_REQUIRES_BUBBLEWRAP_REASON,
          {
            message: err?.message ?? String(err),
            code: err?.code ?? null,
            sandbox_required: true,
            unenforced_fallback_permitted: false,
            conduit_cleanup_failures: conduitCleanupDetail
          }
        );
      }
      if (isClaudeCredentialsReadOnlyFileRefusal(err)) {
        return makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          "claude_executor_credentials_path_invalid",
          err.detail ?? null
        );
      }
      if (launcherOwnedExactSliceReview === true) {
        return makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          CLAUDE_EXACT_SLICE_REVIEW_SANDBOX_REQUIRED_REASON,
          {
            message: err?.message ?? String(err),
            code: err?.code ?? null,
            sandbox_required: true,
            unenforced_fallback_permitted: false
          }
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

    const supervised = await launchWorkspaceAgentFamilyLaunchLifecycle({
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

      killTimeoutMs: conduit === null
        ? killTimeoutMs
        : killTimeoutMs ?? STDIO_MCP_CONDUIT_RUN_TIMEOUT_MS,
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
        : null,

      adaptSupervisedResult: (supervised) =>
        attachDispatchProvenanceToSupervisedResult(
          supervised,
          buildClaudeSupervisedFinalResultWithProvenance({
            enforcement:
              createLauncherObservedDispatchEnforcementForConfirmedIsolatedSpawn()
          })
        )
    });

    if (conduit !== null && supervised?.accepted !== true) {
      const cleanupFailure = await settleStdioMcpConduitCleanup(conduit);
      if (cleanupFailure === null || supervised?.refusal === undefined ||
          supervised.refusal === null) {
        return supervised;
      }
      return {
        ...supervised,
        refusal: {
          ...supervised.refusal,
          detail: {
            ...(supervised.refusal.detail ?? {}),
            conduit_cleanup_failures: cleanupFailure.detail
              ?? { message: cleanupFailure.message ?? String(cleanupFailure) }
          }
        }
      };
    }
    const withConduitOutcome = attachStdioMcpConduitLaunchOutcome(supervised, conduit);
    if (conduit !== null) {
      try {
        await conduit.clientReady;
      } catch {

        await settleStdioMcpConduitCleanup(conduit);
      }
    }
    return withConduitOutcome;
  };
}

export const __TERMINAL_STATUSES_FOR_TESTS = __LAUNCH_CORE_TERMINAL_STATUSES_FOR_TESTS;
