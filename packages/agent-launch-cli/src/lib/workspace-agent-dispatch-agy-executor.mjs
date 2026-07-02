

import { access, constants as fsConstants } from "node:fs/promises";

import {
  BACKEND_FAMILY_UNAVAILABLE_REASONS,
  BACKEND_MISSING_RESULT_CODES,
  BACKEND_REFUSAL_CODES,

  validateLauncherFamilyRole
} from "./workspace-agent-dispatch-backend.mjs";

import {
  buildMissingResultPayload,
  detectNoFindingsLine,
  SHARED_FAMILY_BWRAP_ENV_ALLOWLIST,
  superviseChildLaunch,
  launcherRoleWritePosture,
  LAUNCHER_WRITE_POSTURES
} from "./workspace-agent-launch-core.mjs";
import {
  BubblewrapIsolationError,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  buildBubblewrapLaunchPlan,
  DEFAULT_FAMILY_SYSTEM_READ_ONLY_ROOTS,
  resolveFamilyRuntimeHomePolicyProfile,
  mergeFamilyRuntimeReadOnlyRoots,
  resolveFamilyRuntimeExecutable,
  spawnIsolated as defaultSpawnIsolated
} from "./launch-isolation.mjs";
import {
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_UNAVAILABLE_REASON
} from "./host-write-authority-substrate.mjs";

import {
  delegateToHostWriteAuthority,
  attachDispatchProvenanceToSupervisedResult
} from "./workspace-agent-inprocess-launch-policy.mjs";

import {
  renderLauncherFamilyRoleContract,
  LauncherRoleContractError
} from "./codex-role-prompts.mjs";

import { loadWorkRecordById } from "@agent-chassis/wiki-core";
import {
  resolveCanonicalWriteScope,
  deriveWritableMountsFromWriteScope
} from "./workspace-agent-write-scope.mjs";

import { buildFinalResultEnvelope } from "./workspace-agent-family-adapter-core.mjs";
import { buildFamilyExecutorBwrapPlan } from "./workspace-agent-family-bwrap-plan.mjs";
import { resolveFindingsOnlyAcceptanceContract } from "./workspace-agent-findings-role-context.mjs";
import {
  FAMILY_MODEL_DISPOSITIONS,
  FAMILY_REFUSAL_TRANSPORTS,
  resolveFamilyModelDisposition,
  buildFamilyModelRefusal
} from "./workspace-agent-family-policy.mjs";
import { planFamilyBrokerLaunch } from "./workspace-agent-broker-plan-policy.mjs";
import {
  WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS,
  buildWorkspaceAgentFailOpenPlan
} from "./launch-isolation-failopen.mjs";
import {
  WORKSPACE_AGENT_SANDBOX_OUTCOMES
} from "./workspace-agent-sandbox-decision.mjs";
import { launchWorkspaceAgentFamilyLaunchLifecycle } from "./workspace-agent-family-launch-lifecycle.mjs";
import {
  buildStructuredDispatchProvenance,
  createDispatchProvenanceEnforcementFromSandboxDecision
} from "./workspace-agent-dispatch-provenance.mjs";

import {
  LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM,
  LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO
} from "./workspace-agent-launch-adapter-contract.mjs";

export const AGY_FAMILY_SOURCE_READ_MODE = LAUNCHER_SOURCE_READ_MODE_NATIVE_FILESYSTEM;
export const AGY_FAMILY_NATIVE_READ_CAPABILITY = LAUNCHER_NATIVE_READ_CAPABILITY_BWRAP_RO_REPO;

export const AGY_WORKSPACE_AGENT_LAUNCH_EXECUTOR_SCHEMA_VERSION =
  "agy-workspace-agent-launch-executor.v1";

export const AGY_APP_ID = "agy";

export const DEFAULT_AGY_BINARY_PATH = "/home/user/.local/bin/agy";

export const AGY_FAMILY_SYSTEM_READ_ONLY_ROOTS = Object.freeze([
  ...DEFAULT_FAMILY_SYSTEM_READ_ONLY_ROOTS
]);

export const AGY_FAMILY_RUNTIME_WRITABLE_ROOTS = Object.freeze([
  "/home/user/.gemini"
]);

export const AGY_FAMILY_RUNTIME_READ_ONLY_ROOTS = Object.freeze([
  "/home/user/.gemini/antigravity-cli",
  "/home/user/.gemini/config"
]);

function deriveAgyFamilyRuntimeRootsFromPolicyProfile(profile) {
  if (!profile || typeof profile !== "object" || typeof profile.geminiParent !== "string") {
    return {
      readOnlyRoots: AGY_FAMILY_RUNTIME_READ_ONLY_ROOTS,
      writableRoots: AGY_FAMILY_RUNTIME_WRITABLE_ROOTS
    };
  }
  return {
    readOnlyRoots: Object.freeze([
      `${profile.geminiParent}/antigravity-cli`,
      `${profile.geminiParent}/config`
    ]),
    writableRoots: Object.freeze([profile.geminiParent])
  };
}

export const AGY_BWRAP_ENV_ALLOWLIST = SHARED_FAMILY_BWRAP_ENV_ALLOWLIST;

export const AGY_BWRAP_ENV_POLICY = Object.freeze({
  allow: AGY_BWRAP_ENV_ALLOWLIST
});

export const AGY_EXECUTOR_REFUSAL_REASONS = Object.freeze({
  CLI_BINARY_PATH_NOT_SET: "agy_cli_binary_path_not_set",
  CLI_BINARY_NOT_FOUND: "agy_cli_binary_not_found",
  CLI_BINARY_NOT_EXECUTABLE: "agy_cli_binary_not_executable",
  RUNTIME_NOT_CONFIGURED: "agy_runtime_not_configured",
  PROBE_THREW: "agy_runtime_probe_threw"
});

export const AGY_FINAL_OUTPUT_FINDINGS_SCHEMA_VERSION = "agy-final-output.v1";

export const AGY_PROMPTARGS_FORBIDDEN_PERMISSION_FLAGS = Object.freeze([
  "--dangerously-skip-permissions"
]);

function buildAgyRefusal(reasonDetail, probeDetail) {
  return {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
      reason: BACKEND_FAMILY_UNAVAILABLE_REASONS[AGY_APP_ID],
      detail: {
        app: AGY_APP_ID,
        missing_backend: `workspace_agent_dispatch_backend.launch_executors.${AGY_APP_ID}`,
        reason_detail: reasonDetail,
        ...(probeDetail !== null && probeDetail !== undefined
          ? { probe_detail: probeDetail }
          : {})
      }
    }
  };
}

function buildSpawnRefusal(reason, detail) {
  return {
    accepted: false,
    refusal: {
      code: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      reason,
      detail: detail ?? null
    }
  };
}

function bwrapAvailabilityFromAgyIsolationError(err) {
  return Object.freeze({
    available: false,
    diagnostic: Object.freeze({
      code: err?.code ?? null,
      message: err?.message ?? "Agy isolation backend failed before spawn",
      detail: err?.detail ?? null
    })
  });
}

const AGY_SANDBOX_DECISION_BWRAP_DIAGNOSTIC_CODES = Object.freeze(new Set([
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_UNAVAILABLE,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_NOT_EXECUTABLE,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_PROBE_FAILED,
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.BWRAP_SPAWN_FAILED
]));

export async function defaultProbeAgyRuntime({ agyBinaryPath, accessFn = access } = {}) {
  if (typeof agyBinaryPath !== "string" || agyBinaryPath.length === 0) {
    return {
      available: false,
      reason_detail: AGY_EXECUTOR_REFUSAL_REASONS.CLI_BINARY_PATH_NOT_SET,
      detail: {
        missing: ["agy_cli_binary_path"],
        note:
          "No Agy CLI binary path was supplied to the executor. The MCP " +
          "server wiring (or test caller) must pass `agyBinaryPath` so the " +
          "probe can resolve the Antigravity CLI."
      }
    };
  }
  try {
    await accessFn(agyBinaryPath, fsConstants.X_OK);
  } catch (err) {
    if (err?.code === "ENOENT") {
      return {
        available: false,
        reason_detail: AGY_EXECUTOR_REFUSAL_REASONS.CLI_BINARY_NOT_FOUND,
        detail: {
          agy_cli_binary_path: agyBinaryPath,
          code: err?.code ?? null,
          message: err?.message ?? String(err)
        }
      };
    }
    return {
      available: false,
      reason_detail: AGY_EXECUTOR_REFUSAL_REASONS.CLI_BINARY_NOT_EXECUTABLE,
      detail: {
        agy_cli_binary_path: agyBinaryPath,
        code: err?.code ?? null,
        message: err?.message ?? String(err)
      }
    };
  }
  return {
    available: true,
    agyBinary: agyBinaryPath,
    detail: { agy_cli_binary_path: agyBinaryPath }
  };
}

export function defaultBuildAgyArgs({
  role,
  subject,
  workspaceDir,
  promptArgs,
  acceptanceCriteria = [],
  acceptanceValidation = []
}) {

  const roleCheck = validateLauncherFamilyRole(role);
  if (!roleCheck.ok) {
    throw new LauncherRoleContractError(
      roleCheck.kind === "missing"
        ? "launcher role contract requires a role"
        : `launcher role contract does not support role: ${role}`,
      {
        code: roleCheck.kind === "missing" ? "role_required" : "role_unsupported",
        detail: { role: role ?? null, allowed: roleCheck.allowed ?? null }
      }
    );
  }
  const normalizedRole = typeof role === "string" ? role.trim() : "";
  if (Array.isArray(promptArgs) && promptArgs.length > 0) {

    const roleMayCarryWriteFlag =
      launcherRoleWritePosture(normalizedRole) ===
      LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE;
    if (!roleMayCarryWriteFlag) {
      const forbiddenFound = promptArgs.filter(
        (arg) => AGY_PROMPTARGS_FORBIDDEN_PERMISSION_FLAGS.includes(arg)
      );
      if (forbiddenFound.length > 0) {
        throw new LauncherRoleContractError(
          `launcher role contract forbids permission flag for ${normalizedRole}: ${forbiddenFound[0]}`,
          {
            code: "forbidden_permission_flag_in_prompt_args",
            detail: { role, forbidden: forbiddenFound, allowed_roles: ["worker"] }
          }
        );
      }
    }
  }

  const renderedRolePrompt = renderLauncherFamilyRoleContract({
    role,
    subject,
    workspaceDir,
    acceptanceCriteria,
    acceptanceValidation
  });
  const supplementalPrompt = Array.isArray(promptArgs) && promptArgs.length > 0
    ? `\n\nAdditional instructions:\n\n${promptArgs.join(" ")}`
    : "";
  const prompt = `${renderedRolePrompt}${supplementalPrompt}`;

  const args = ["--print"];
  if (
    launcherRoleWritePosture(normalizedRole) ===
    LAUNCHER_WRITE_POSTURES.ASSIGNED_WRITE_SCOPE
  ) {
    args.push("--dangerously-skip-permissions");
  }
  args.push(prompt);
  return args;
}

export { resolveCanonicalWriteScope };

export function deriveAgyWritableMountsFromWriteScope(options = {}) {
  return deriveWritableMountsFromWriteScope(options);
}

export function defaultBuildAgyBwrapPlan({
  command,
  args,
  workspaceDir,
  env,

  writeScope = [],
  familyRuntimeReadOnlyRoots = AGY_FAMILY_RUNTIME_READ_ONLY_ROOTS,
  familySystemReadOnlyRoots = AGY_FAMILY_SYSTEM_READ_ONLY_ROOTS,
  familyRuntimeWritableRoots = AGY_FAMILY_RUNTIME_WRITABLE_ROOTS,
  familyRuntimePolicyProfile = null,

  resolveExecutable = resolveFamilyRuntimeExecutable
}) {

  return buildFamilyExecutorBwrapPlan({
    command,
    args,
    workspaceDir,
    env,
    writeScope,
    envPolicy: AGY_BWRAP_ENV_POLICY,
    familyRuntimeReadOnlyRoots,
    familySystemReadOnlyRoots,
    familyRuntimeWritableRoots,
    familyRuntimePolicyProfile,
    executableLabel: "agyExecutable",
    shareNet: true,
    resolveExecutable,
    mergeRuntimeReadOnlyRoots: mergeFamilyRuntimeReadOnlyRoots,
    deriveWritableMounts: deriveWritableMountsFromWriteScope,
    buildBubblewrapLaunchPlan
  });
}

export function defaultSpawnAgyChild({
  agyBinary,
  args,
  env,
  cwd,

  writeScope = [],
  buildBwrapPlan = defaultBuildAgyBwrapPlan,
  spawnIsolated = defaultSpawnIsolated,
  familyRuntimeReadOnlyRoots = AGY_FAMILY_RUNTIME_READ_ONLY_ROOTS,
  familySystemReadOnlyRoots = AGY_FAMILY_SYSTEM_READ_ONLY_ROOTS,
  familyRuntimeWritableRoots = AGY_FAMILY_RUNTIME_WRITABLE_ROOTS,
  familyRuntimePolicyProfile = null
} = {}) {
  const workspaceDir = typeof cwd === "string" && cwd.length > 0
    ? cwd
    : null;
  const plan = buildBwrapPlan({
    command: agyBinary,
    args: Array.isArray(args) ? args : [],
    workspaceDir,
    env: env ?? null,
    writeScope: Array.isArray(writeScope) ? writeScope : [],
    familyRuntimeReadOnlyRoots,
    familySystemReadOnlyRoots,
    familyRuntimeWritableRoots,
    familyRuntimePolicyProfile
  });
  return spawnIsolated(plan, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false
  });
}

async function spawnPlainChildProcess(command, args, options) {
  const childProcess = await import("node:" + "child_process");
  return childProcess.spawn(command, Array.isArray(args) ? [...args] : [], options);
}

function buildAgyChildRunProvenance({
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

function buildAgySupervisedFinalResultWithProvenance(provenanceContext) {
  return (finalResult) => ({
    ...finalResult,
    provenance: buildAgyChildRunProvenance(provenanceContext)
  });
}

export async function defaultCaptureAgyFinalResult({
  status,
  exit,
  stdout,
  stderr,
  role,
  subject
}) {
  const stdoutText = typeof stdout === "string" ? stdout : "";
  const stderrText = typeof stderr === "string" ? stderr : "";

  if (stdoutText.trim().length === 0) {
    if (stderrText.trim().length > 0) {
      return buildMissingResultPayload(
        BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
        "agy_stdout_empty_with_stderr"
      );
    }
    return buildMissingResultPayload(
      BACKEND_MISSING_RESULT_CODES.FINAL_REPORT_NOT_CAPTURED,
      "agy_stdout_empty"
    );
  }

  const noFindingsLine = detectNoFindingsLine(stdoutText);
  if (noFindingsLine !== null) {

    return buildFinalResultEnvelope({
      kind: "no_findings",
      payload: Object.freeze({
        reason: noFindingsLine,
        format: "text",
        text: stdoutText,
        source: Object.freeze({ kind: "stdout", bytes: stdoutText.length })
      })
    });
  }

  return buildFinalResultEnvelope({
    kind: "findings",
    payload: Object.freeze({
      schema_version: AGY_FINAL_OUTPUT_FINDINGS_SCHEMA_VERSION,
      format: "text",
      role: role ?? null,
      subject: subject ?? null,
      source: Object.freeze({ kind: "stdout", bytes: stdoutText.length }),
      text: stdoutText
    })
  });
}

export function createAgyWorkspaceAgentLaunchExecutor(options = {}) {
  const {
    probeAgyRuntime = defaultProbeAgyRuntime,
    buildAgyArgs = defaultBuildAgyArgs,
    captureFinalResult = defaultCaptureAgyFinalResult,
    agyBinaryPath = DEFAULT_AGY_BINARY_PATH,
    promptArgs = [],
    env = process.env,
    cwd: defaultCwd = process.cwd(),

    loadWorkRecord = loadWorkRecordById,

    killTimeoutMs = null,

    buildBwrapPlan = defaultBuildAgyBwrapPlan,
    spawnIsolated = defaultSpawnIsolated,
    plainSpawn = spawnPlainChildProcess,
    resolveUnsandboxedOptIn = undefined,
    probeCanonicalBwrapAvailability = undefined,
    familyRuntimeReadOnlyRoots = null,
    familySystemReadOnlyRoots = AGY_FAMILY_SYSTEM_READ_ONLY_ROOTS,
    familyRuntimeWritableRoots = null,
    resolveFamilyRuntimePolicyProfile = resolveFamilyRuntimeHomePolicyProfile,

    hostWriteAuthority = null
  } = options;
  return async function agyLaunchExecutor(input) {
    const role = input?.role ?? null;
    const subject = input?.subject ?? null;
    const workspaceAlias = input?.workspace_alias ?? null;
    const workspaceDir = typeof input?.workspace_dir === "string" && input.workspace_dir.length > 0
      ? input.workspace_dir
      : null;

    const agyModelDisposition = resolveFamilyModelDisposition({ model: input?.model });
    if (agyModelDisposition.disposition === FAMILY_MODEL_DISPOSITIONS.REFUSE) {
      return buildFamilyModelRefusal({
        transport: FAMILY_REFUSAL_TRANSPORTS.IN_PROCESS,
        code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        reason: "model_hint_unsupported_for_agy_executor",
        detail: { app: AGY_APP_ID, model: agyModelDisposition.model }
      });
    }

    const runtimeProfileResult = resolveFamilyRuntimePolicyProfile({
      source: "agy_family_runtime_host_home"
    });
    if (!runtimeProfileResult || runtimeProfileResult.ok !== true) {
      return buildFamilyModelRefusal({
        transport: FAMILY_REFUSAL_TRANSPORTS.IN_PROCESS,
        code: BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        reason: runtimeProfileResult?.reason ?? "launcher_runtime_home_fact_unresolvable",
        detail: runtimeProfileResult?.detail ?? { fact: "agy_family_runtime_host_home" }
      });
    }
    const familyRuntimePolicyProfile = runtimeProfileResult.profile;
    const derivedAgyRuntimeRoots =
      deriveAgyFamilyRuntimeRootsFromPolicyProfile(familyRuntimePolicyProfile);
    const effectiveFamilyRuntimeReadOnlyRoots = Array.isArray(familyRuntimeReadOnlyRoots)
      ? familyRuntimeReadOnlyRoots
      : derivedAgyRuntimeRoots.readOnlyRoots;
    const effectiveFamilyRuntimeWritableRoots = Array.isArray(familyRuntimeWritableRoots)
      ? familyRuntimeWritableRoots
      : derivedAgyRuntimeRoots.writableRoots;
    const spawnAgyChild = options.spawnAgyChild ?? ((ctx) => defaultSpawnAgyChild({
      ...ctx,
      buildBwrapPlan,
      spawnIsolated,
      familyRuntimeReadOnlyRoots: effectiveFamilyRuntimeReadOnlyRoots,
      familySystemReadOnlyRoots,
      familyRuntimeWritableRoots: effectiveFamilyRuntimeWritableRoots,
      familyRuntimePolicyProfile
    }));

    let probe;
    try {
      probe = await probeAgyRuntime({
        role,
        subject,
        workspace_alias: workspaceAlias,
        workspace_dir: workspaceDir,
        app: AGY_APP_ID,
        agyBinaryPath
      });
    } catch (err) {
      return buildAgyRefusal(
        AGY_EXECUTOR_REFUSAL_REASONS.PROBE_THREW,
        { message: err?.message ?? String(err) }
      );
    }

    if (!probe || typeof probe !== "object" || probe.available !== true) {
      const allowedReasons = Object.values(AGY_EXECUTOR_REFUSAL_REASONS);
      const reasonDetail =
        probe && typeof probe === "object" && typeof probe.reason_detail === "string"
          && allowedReasons.includes(probe.reason_detail)
          ? probe.reason_detail
          : AGY_EXECUTOR_REFUSAL_REASONS.RUNTIME_NOT_CONFIGURED;
      return buildAgyRefusal(
        reasonDetail,
        probe && typeof probe === "object" ? (probe.detail ?? null) : null
      );
    }

    const agyBinary = typeof probe.agyBinary === "string" && probe.agyBinary.length > 0
      ? probe.agyBinary
      : agyBinaryPath;
    if (typeof agyBinary !== "string" || agyBinary.length === 0) {
      return buildAgyRefusal(
        AGY_EXECUTOR_REFUSAL_REASONS.CLI_BINARY_PATH_NOT_SET,
        { note: "probe reported available but did not yield an Agy CLI binary path" }
      );
    }

    if (typeof hostWriteAuthority === "function") {
      return delegateToHostWriteAuthority({
        invoke: () => hostWriteAuthority({
          ...input,
          substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID
        }),
        onThrew: (err) => buildAgyRefusal(
          AGY_EXECUTOR_REFUSAL_REASONS.PROBE_THREW,
          { substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID, message: err?.message ?? String(err) }
        ),
        onMissingResult: () => buildSpawnRefusal("agy_host_write_authority_no_result", {
          substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID
        })
      });
    }

    let findingsOnlyAcceptance;
    try {
      findingsOnlyAcceptance = await resolveFindingsOnlyAcceptanceContract({
        role,
        subject,
        workspaceDir,
        loadWorkRecord
      });
    } catch (err) {
      return buildSpawnRefusal("agy_build_args_threw", {
        message: err?.message ?? String(err),
        code: err?.code ?? null,
        detail: err?.detail ?? null
      });
    }

    let args;
    try {
      args = buildAgyArgs({
        role,
        subject,
        workspaceDir,
        workspaceAlias,
        promptArgs,
        app: AGY_APP_ID,
        acceptanceCriteria: findingsOnlyAcceptance?.acceptanceCriteria ?? [],
        acceptanceValidation: findingsOnlyAcceptance?.acceptanceValidation ?? []
      });
    } catch (err) {
      return buildSpawnRefusal("agy_build_args_threw", {
        message: err?.message ?? String(err)
      });
    }
    if (!Array.isArray(args)) {
      return buildSpawnRefusal("agy_build_args_invalid", {
        received_type: typeof args
      });
    }

    const writeScope = await resolveCanonicalWriteScope({
      subject,
      workspaceDir,
      loadWorkRecord
    });

    const planCwd = workspaceDir ?? defaultCwd;

    let child;
    try {
      child = spawnAgyChild({
        agyBinary,
        args,
        env,
        cwd: planCwd,

        writeScope,
        role,
        subject
      });
    } catch (err) {
      if (
        err instanceof BubblewrapIsolationError
        && AGY_SANDBOX_DECISION_BWRAP_DIAGNOSTIC_CODES.has(err.code)
      ) {
        const failOpenPlan = buildWorkspaceAgentFailOpenPlan({
          launchFacts: {
            command: agyBinary,
            args,
            cwd: planCwd,
            env
          },
          role,
          subject,
          workspaceDir: planCwd,
          resolveUnsandboxedOptIn,
          probeCanonicalBwrapAvailability: () =>
            bwrapAvailabilityFromAgyIsolationError(err)
        });
        if (
          failOpenPlan.sandbox_decision?.outcome
            === WORKSPACE_AGENT_SANDBOX_OUTCOMES.UNENFORCED_PLAIN_LAUNCH
          && failOpenPlan.disposition
            === WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN
        ) {
          if (!failOpenPlan.plan || typeof failOpenPlan.plan !== "object") {
            return buildSpawnRefusal("plain_spawn_no_child", null);
          }
          return launchWorkspaceAgentFamilyLaunchLifecycle({
            command: failOpenPlan.plan.command,
            args: failOpenPlan.plan.args,
            cwd: failOpenPlan.plan.cwd,
            env: failOpenPlan.plan.env,
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
                stdout,
                stderr,
                workspaceDir,
                agyBinary
              }),
            role,
            subject,
            kind: "agy",
            killTimeoutMs,
            passthrough: { workspaceDir, agyBinary },
            warning: failOpenPlan.warning,
            enforcement: failOpenPlan.enforcement,
            buildSpawnThrewRefusal: (detail) =>
              buildSpawnRefusal("plain_spawn_threw", detail),
            buildNoChildRefusal: () =>
              buildSpawnRefusal("plain_spawn_no_child", null),
            adaptSupervisedResult: (supervised) =>
              attachDispatchProvenanceToSupervisedResult(
                supervised,
                buildAgySupervisedFinalResultWithProvenance({
                  sandboxDecision: failOpenPlan.sandbox_decision
                })
              )
          });
        }
        if (
          failOpenPlan?.sandbox_decision?.outcome
            === WORKSPACE_AGENT_SANDBOX_OUTCOMES.REFUSED
        ) {
          return buildSpawnRefusal(
            failOpenPlan.sandbox_decision.refusal?.reason ?? "agy_sandbox_decision_refused",
            failOpenPlan.sandbox_decision.refusal?.detail ?? null
          );
        }
      }

      if (
        err instanceof BubblewrapIsolationError
        && err.code === BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.WRITABLE_RUNTIME_ROOT_NOT_VISIBLE_IN_NAMESPACE
      ) {
        return {
          accepted: false,
          refusal: {
            code: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
            reason: HOST_WRITE_AUTHORITY_SUBSTRATE_UNAVAILABLE_REASON,
            detail: {
              substrate_id: HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
              missing_backend: "workspace_agent_dispatch_agy_executor.hostWriteAuthority",
              diagnostic_code: err.code,
              detail: err.detail ?? null,
              message: err.message ?? null
            }
          }
        };
      }
      return buildSpawnRefusal("agy_spawn_threw", {
        message: err?.message ?? String(err)
      });
    }
    if (!child || typeof child !== "object") {
      return buildSpawnRefusal("agy_spawn_no_child", null);
    }

    return superviseChildLaunch({
      child,
      parseFinalResult: ({ status, exit, stdout, stderr }) =>
        captureFinalResult({
          status,
          exit,
          role,
          subject,
          stdout,
          stderr,
          workspaceDir,
          agyBinary
        }),
      role,
      subject,
      family: "agy",
      killTimeoutMs,
      passthrough: { workspaceDir, agyBinary }
    });
  };
}

export function createHostWriteAuthorityBrokerAgyPlanLaunch({
  probeAgyRuntime = defaultProbeAgyRuntime,
  buildArgs = defaultBuildAgyArgs,
  buildBwrapPlan = defaultBuildAgyBwrapPlan,
  agyBinaryPath = DEFAULT_AGY_BINARY_PATH,
  env = process.env,
  captureFinalResult = defaultCaptureAgyFinalResult,

  loadWorkRecord = loadWorkRecordById,
  resolveFamilyRuntimePolicyProfile = resolveFamilyRuntimeHomePolicyProfile
} = {}) {

  return async function agyBrokerPlanLaunch(launchInput) {
    const runtimeProfileResult = resolveFamilyRuntimePolicyProfile({
      source: "agy_family_runtime_host_home"
    });
    if (!runtimeProfileResult || runtimeProfileResult.ok !== true) {
      return {
        ok: false,
        refusal: {
          reason: runtimeProfileResult?.reason ?? "launcher_runtime_home_fact_unresolvable",
          detail: runtimeProfileResult?.detail ?? { fact: "agy_family_runtime_host_home" }
        }
      };
    }
    const familyRuntimePolicyProfile = runtimeProfileResult.profile;
    const derivedAgyRuntimeRoots =
      deriveAgyFamilyRuntimeRootsFromPolicyProfile(familyRuntimePolicyProfile);
    return planFamilyBrokerLaunch({
      app: AGY_APP_ID,
      env,
      launchInput,

      parseFinalResult: ({ status, exit, plan, stdout, stderr }) =>
        captureFinalResult({
          status,
          exit,
          role: plan?.role ?? null,
          subject: plan?.subject ?? null,
          stdout,
          stderr
        }),

      mapStepError: (stage, err) => {
        if (stage === "command") {
          return {
            reason: "agy_broker_args_build_threw",
            detail: {
              app: AGY_APP_ID,
              message: err?.message ?? String(err),
              code: err?.code ?? null,
              detail: err?.detail ?? null
            }
          };
        }
        if (stage === "bwrap") {
          return {
            reason: "agy_broker_bwrap_plan_threw",
            detail: { app: AGY_APP_ID, message: err?.message ?? String(err), code: err?.code ?? null }
          };
        }
        return null;
      },
      steps: {

        model: () => {
          const agyModelDisposition = resolveFamilyModelDisposition({ model: launchInput?.model });
          if (agyModelDisposition.disposition === FAMILY_MODEL_DISPOSITIONS.REFUSE) {
            return {
              refusal: {
                reason: "model_hint_unsupported_for_agy_executor",
                detail: { app: AGY_APP_ID, model: agyModelDisposition.model }
              }
            };
          }
          return null;
        },

        write_scope: async (ctx) => {
          const writeScope = await resolveCanonicalWriteScope({
            subject: ctx.subject,
            workspaceDir: ctx.workspaceDir,
            loadWorkRecord
          });
          return { writeScope };
        },

        probe: async () => {
          let probe;
          try {
            probe = await probeAgyRuntime({ agyBinaryPath });
          } catch (err) {
            return {
              refusal: {
                reason: BACKEND_FAMILY_UNAVAILABLE_REASONS[AGY_APP_ID],
                detail: {
                  app: AGY_APP_ID,
                  missing_backend: `workspace_agent_dispatch_backend.launch_executors.${AGY_APP_ID}`,
                  reason_detail: AGY_EXECUTOR_REFUSAL_REASONS.PROBE_THREW,
                  probe_detail: { agy_cli_binary_path: agyBinaryPath },
                  probe_error: { message: err?.message ?? String(err), code: err?.code ?? null }
                }
              }
            };
          }
          if (!probe || typeof probe !== "object" || probe.available !== true) {
            return {
              refusal: {
                reason: BACKEND_FAMILY_UNAVAILABLE_REASONS[AGY_APP_ID],
                detail: {
                  app: AGY_APP_ID,
                  missing_backend: `workspace_agent_dispatch_backend.launch_executors.${AGY_APP_ID}`,
                  reason_detail: probe?.reason_detail ?? AGY_EXECUTOR_REFUSAL_REASONS.RUNTIME_NOT_CONFIGURED,
                  probe_detail: probe?.detail ?? { agy_cli_binary_path: agyBinaryPath }
                }
              }
            };
          }
          return { resolvedAgyBinary: probe.agyBinary ?? agyBinaryPath };
        },

        command: async (ctx) => {
          const findingsOnlyAcceptance = await resolveFindingsOnlyAcceptanceContract({
            role: ctx.role,
            subject: ctx.subject,
            workspaceDir: ctx.workspaceDir,
            loadWorkRecord
          });
          const args = buildArgs({
            role: ctx.role,
            subject: ctx.subject,
            workspaceDir: ctx.workspaceDir,
            promptArgs: [],
            acceptanceCriteria: findingsOnlyAcceptance?.acceptanceCriteria ?? [],
            acceptanceValidation: findingsOnlyAcceptance?.acceptanceValidation ?? []
          });
          return { command: ctx.resolvedAgyBinary, args: Array.isArray(args) ? args : [] };
        },

        bwrap: (ctx) => {
          const bwrapPlan = buildBwrapPlan({
            command: ctx.resolvedAgyBinary,
            args: Array.isArray(ctx.args) ? ctx.args : [],
            workspaceDir: ctx.workspaceDir,
            env,
            writeScope: ctx.writeScope,
            familyRuntimeReadOnlyRoots: derivedAgyRuntimeRoots.readOnlyRoots,
            familyRuntimeWritableRoots: derivedAgyRuntimeRoots.writableRoots,
            familyRuntimePolicyProfile
          });
          return { bwrapPlan };
        }
      }
    });
  };
}
