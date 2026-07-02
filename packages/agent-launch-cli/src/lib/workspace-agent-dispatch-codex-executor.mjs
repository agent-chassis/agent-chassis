

import {
  BACKEND_REFUSAL_CODES,

  normalizeDispatchModelHint,
  validateLauncherFamilyRole
} from "./workspace-agent-dispatch-backend.mjs";
import { loadWorkRecordById } from "@agent-chassis/wiki-core";

import {
  __LAUNCH_CORE_TERMINAL_STATUSES_FOR_TESTS,
  superviseChildLaunch
} from "./workspace-agent-launch-core.mjs";

import {
  adaptFamilyBrokerRefusal,
  resolveFamilyExecutorRole
} from "./workspace-agent-family-launch-policy.mjs";
import {
  HOST_WRITE_AUTHORITY_BROKER_REFUSAL_REASONS,
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_UNAVAILABLE_REASON
} from "./host-write-authority-substrate.mjs";
import {
  BubblewrapIsolationError,
  assertBubblewrapAvailable,
  spawnIsolated
} from "./launch-isolation.mjs";
import {
  buildCodexRolePlan,
  buildCodexRoleBubblewrapPlan,
  findRepoRoot
} from "../commands/codex-role.mjs";
import {
  resolveFamilyRoleModelGate
} from "./workspace-agent-family-policy.mjs";
import {
  createLauncherOwnedSourceToolSurfacePreparer
} from "./agent-backend.mjs";
import { ensureNewWorkerWriteRoots } from "./codex-worker-plan.mjs";

import {
  buildStructuredDispatchProvenance,
  createDispatchProvenanceEnforcementFromSandboxDecision,
  describeDispatchArtifactReference
} from "./workspace-agent-dispatch-provenance.mjs";

import {
  CODEX_LAUNCH_POLICY_ENACTMENT,
  CODEX_LAUNCH_POLICY_FAIL_CLOSED_CLASS,
  CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS,
  buildCodexSourceSurfacePreparerThrewRefusal,
  classifyCodexLaunchEnactment,
  classifyCodexRederivedSourceToolSurface,
  classifyCodexSuppliedSourceToolSurface
} from "./workspace-agent-codex-launch-policy.mjs";
import {
  WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS,
  buildWorkspaceAgentFailOpenPlan
} from "./launch-isolation-failopen.mjs";
import {
  WORKSPACE_AGENT_SANDBOX_OUTCOMES
} from "./workspace-agent-sandbox-decision.mjs";
import { launchWorkspaceAgentFamilyLaunchLifecycle } from "./workspace-agent-family-launch-lifecycle.mjs";

import {
  CODEX_CLEAN_REVIEW_LINE_PATTERN,
  CODEX_FINAL_MESSAGE_FINDINGS_SCHEMA_VERSION,
  codexTransportSecretEnvVars,
  defaultCaptureCodexFinalResult,
  detectCodexCleanReviewLine,
  redactCodexTransportSecrets
} from "./workspace-agent-codex-final-result.mjs";
import { resolveFindingsOnlyAcceptanceContract } from "./workspace-agent-findings-role-context.mjs";

import {
  CODEX_EXECUTOR_ROLE_MAP,
  CODEX_FAMILY_SOURCE_READ_MODE,
  CODEX_SANDBOX_DECISION_BWRAP_DIAGNOSTIC_CODES,
  CODEX_WORKSPACE_AGENT_LAUNCH_EXECUTOR_SCHEMA_VERSION,
  buildCodexFailOpenClosedRefusal,
  buildCodexLaunchArtifacts,
  bwrapAvailabilityFromCodexIsolationError,
  makeRefusal,
  mapCodexArtifactsFailureToBrokerRefusal,
  mapCodexArtifactsFailureToInProcessRefusal,
  resolveCodexTerminalStructuredRoleResultMode
} from "./workspace-agent-dispatch-codex-launch-support.mjs";

import { resolveLauncherSchemaConstrainedTierIsPaid } from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
export {
  CODEX_CLEAN_REVIEW_LINE_PATTERN,
  CODEX_FINAL_MESSAGE_FINDINGS_SCHEMA_VERSION,
  defaultCaptureCodexFinalResult,
  detectCodexCleanReviewLine,
  redactCodexTransportSecrets
};

export {
  CODEX_EXECUTOR_ROLE_MAP,
  CODEX_FAMILY_SOURCE_READ_MODE,
  CODEX_WORKSPACE_AGENT_LAUNCH_EXECUTOR_SCHEMA_VERSION
};

export {
  HOST_WRITE_AUTHORITY_SUBSTRATE_ID,
  HOST_WRITE_AUTHORITY_SUBSTRATE_UNAVAILABLE_REASON
};

const SOURCE_SURFACE_FAIL_CLOSED_CODE = Object.freeze({
  [CODEX_LAUNCH_POLICY_FAIL_CLOSED_CLASS.BACKEND_UNAVAILABLE]: BACKEND_REFUSAL_CODES.BACKEND_UNAVAILABLE,
  [CODEX_LAUNCH_POLICY_FAIL_CLOSED_CLASS.LAUNCH_FAILED_BEFORE_START]: BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START
});

async function resolveCodexWorkerSourceSurfacePolicy({
  role,
  suppliedSourceToolSurface,
  preparer,
  preparerInput
}) {
  const supplied = classifyCodexSuppliedSourceToolSurface({ role, suppliedSourceToolSurface });
  if (
    supplied.disposition
    !== CODEX_LAUNCH_POLICY_SOURCE_SURFACE_DISPOSITIONS.REQUIRES_LAUNCHER_REDERIVATION
  ) {

    return supplied;
  }

  let rederivedSurface;
  try {
    rederivedSurface = await preparer(preparerInput);
  } catch (err) {
    return buildCodexSourceSurfacePreparerThrewRefusal(err);
  }
  return classifyCodexRederivedSourceToolSurface({ rederivedSurface });
}

async function resolveWorkspaceEnvDir(cwd) {
  try {
    return await findRepoRoot(cwd);
  } catch {
    return null;
  }
}

async function evaluateDispatchRoleModelGate({ role, isWorker, resolvedProfile, modelHint, cwd }) {
  const resolvedProfileModel = typeof resolvedProfile?.model === "string" && resolvedProfile.model.length > 0
    ? resolvedProfile.model
    : null;
  if (resolvedProfileModel !== null) {
    const hint = normalizeDispatchModelHint(modelHint);
    if (hint !== null && hint !== resolvedProfileModel) {
      return {
        ok: false,
        reason: "model_hint_diverges_from_resolved_model",
        detail: { requested: hint, resolved: resolvedProfileModel }
      };
    }
    return {
      ok: true,
      resolvedProfile,
      model: resolvedProfileModel,
      modelHint: hint
    };
  }
  return resolveFamilyRoleModelGate({
    role,
    isWorker,
    resolvedProfile,
    modelHint,
    cwd,
    resolveWorkspaceEnvDir
  });
}

async function buildCodexChildRunProvenance({
  finalPath,
  logPath,
  env,
  enforcement = null,
  sandboxDecision = null
}) {

  const effectiveEnforcement = sandboxDecision
    ? createDispatchProvenanceEnforcementFromSandboxDecision(sandboxDecision)
    : enforcement;
  const transportSecrets = codexTransportSecretEnvVars()
    .map((name) => (env && typeof env === "object" ? env[name] : null))
    .filter((value) => typeof value === "string" && value.length > 0);
  const artifacts = [];
  const finalRef = typeof finalPath === "string" && finalPath.length > 0
    ? await describeDispatchArtifactReference({
        kind: "final_response",
        path: finalPath,
        mediaType: "text/markdown",
        sensitivity: "routine",
        transportSecrets
      })
    : null;
  if (finalRef) artifacts.push(finalRef);
  const logRef = typeof logPath === "string" && logPath.length > 0
    ? await describeDispatchArtifactReference({
        kind: "session_log",
        path: logPath,
        mediaType: "text/plain",
        sensitivity: "sensitive",
        transportSecrets
      })
    : null;
  if (logRef) artifacts.push(logRef);
  const transcriptSource = logRef && logRef.exists
    ? "runtime_artifact"
    : finalRef && finalRef.exists
      ? "child_process_output_file"
      : "unavailable";
  return buildStructuredDispatchProvenance({ transcriptSource, enforcement: effectiveEnforcement, artifacts, transportSecrets });
}

async function attachCodexChildRunProvenance(envelope, context) {
  if (!envelope || typeof envelope !== "object") {
    return envelope;
  }
  const provenance = await buildCodexChildRunProvenance(context);
  return { ...envelope, provenance };
}

function attachProvenanceToSupervisedResult(supervised, provenanceContext) {
  if (!supervised || typeof supervised !== "object" || typeof supervised.probe !== "function") {
    return supervised;
  }
  const innerProbe = supervised.probe;
  return {
    ...supervised,
    probe: async () => {
      const probed = await innerProbe();
      if (
        probed &&
        typeof probed === "object" &&
        probed.final_result &&
        typeof probed.final_result === "object"
      ) {
        return {
          ...probed,
          final_result: await attachCodexChildRunProvenance(probed.final_result, provenanceContext)
        };
      }
      return probed;
    }
  };
}

function captureCodexFinalResultFromPlan(captureFinalResult) {
  return async function codexParseFinalResult({ status, exit, plan, stdout, stderr }) {
    const finalPath = typeof plan?.finalPath === "string" && plan.finalPath.length > 0
      ? plan.finalPath
      : null;
    const logPath = typeof plan?.logPath === "string" && plan.logPath.length > 0
      ? plan.logPath
      : null;
    const envelope = await captureFinalResult({
      status,
      exit,
      finalPath,
      role: plan?.role ?? null,
      codexRole: plan?.role ?? null,
      subject: plan?.subject ?? null,
      stderr,
      env: plan?.env
    });
    return attachCodexChildRunProvenance(envelope, { finalPath, logPath, env: plan?.env });
  };
}

async function spawnPlainChildProcess(command, args, options) {
  const childProcess = await import("node:" + "child_process");
  return childProcess.spawn(command, Array.isArray(args) ? [...args] : [], options);
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
    const effectiveResolvedProfile = inProcessModelGate.resolvedProfile;

    let findingsOnlyAcceptance;
    try {
      findingsOnlyAcceptance = await resolveFindingsOnlyAcceptanceContract({
        role: codexRole,
        subject,
        workspaceDir: workspaceDir ?? defaultCwd,
        loadWorkRecord
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
        model: input?.model ?? null
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
    const forwardedSourceToolSurface = sourceSurfacePolicy.forwardedSourceToolSurface;

    const launchEnactment = classifyCodexLaunchEnactment({
      hostWriteAuthorityConfigured: typeof hostWriteAuthority === "function"
    });
    if (launchEnactment.enactment === CODEX_LAUNCH_POLICY_ENACTMENT.DELEGATE_HOST_WRITE_AUTHORITY) {
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

    const schemaConstrainedTierIsPaid = workspaceDir
      ? resolveSchemaConstrainedTier({ workspaceDir }) === true
      : false;
    const terminalStructuredRoleResultMode = resolveCodexTerminalStructuredRoleResultMode({
      schemaConstrainedTierIsPaid,
      codexRole
    });

    const artifacts = await buildCodexLaunchArtifacts({
      planArgs: {
        role: codexRole,
        subject,
        promptArgs,
        env,
        cwd: planCwd,

        resolvedProfile: effectiveResolvedProfile,
        workspaceAlias,
        workspaceDir,
        acceptanceCriteria: findingsOnlyAcceptance?.acceptanceCriteria ?? [],
        acceptanceValidation: findingsOnlyAcceptance?.acceptanceValidation ?? [],

        sourceToolSurface: forwardedSourceToolSurface,

        terminalStructuredRoleResultMode,
      },
      buildPlan,
      buildBwrapPlan,
      ensureWriteRoots,
      assertBwrap
    });
    if (!artifacts.ok) {
      if (artifacts.stage === "assert_bwrap_isolation") {

        const failOpenPlan = buildWorkspaceAgentFailOpenPlan({
          launchFacts: {
            command: artifacts.plan?.command,
            args: artifacts.plan?.args,
            cwd: planCwd,
            env: artifacts.plan?.env
          },
          role,
          subject,
          workspaceDir: planCwd,
          resolveUnsandboxedOptIn,
          classifyIsolationBackendAvailability,
          probeCanonicalBwrapAvailability
        });
        const finalPath = typeof artifacts.plan?.finalPath === "string" && artifacts.plan.finalPath.length > 0
          ? artifacts.plan.finalPath
          : null;
        const logPath = typeof artifacts.plan?.logPath === "string" && artifacts.plan.logPath.length > 0
          ? artifacts.plan.logPath
          : null;
        if (
          failOpenPlan?.sandbox_decision?.outcome
            === WORKSPACE_AGENT_SANDBOX_OUTCOMES.UNENFORCED_PLAIN_LAUNCH
          && failOpenPlan.disposition
            === WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN
        ) {
          const failOpenLaunchPlan = failOpenPlan.plan ?? {};
          return launchWorkspaceAgentFamilyLaunchLifecycle({
            command: failOpenLaunchPlan.command,
            args: failOpenLaunchPlan.args,
            cwd: failOpenLaunchPlan.cwd,
            env: failOpenLaunchPlan.env,
            options: {
              stdio: ["ignore", "pipe", "pipe"],
              detached: false
            },
            spawn: plainSpawn,
            superviseChildLaunch,
            parseFinalResult: ({ status, exit, finalPath: fp, logPath: lp, codexRole: cr, stderr }) =>
              captureFinalResult({ status, exit, finalPath: fp, logPath: lp, role, codexRole: cr, subject, workspaceDir, stderr, env }),
            role,
            subject,
            kind: "codex",
            killTimeoutMs,
            passthrough: { finalPath, logPath, codexRole, workspaceDir },
            warning: failOpenPlan.warning,
            enforcement: failOpenPlan.enforcement,
            buildSpawnThrewRefusal: (detail) =>
              makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, "plain_spawn_threw", detail),
            buildNoChildRefusal: () =>
              makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, "plain_spawn_no_child", null),
            adaptSupervisedResult: (supervised) =>
              attachProvenanceToSupervisedResult(supervised, {
                finalPath,
                logPath,
                env: failOpenLaunchPlan.env,
                sandboxDecision: failOpenPlan.sandbox_decision
              })
          });
        }
        return buildCodexFailOpenClosedRefusal(failOpenPlan);
      }
      return mapCodexArtifactsFailureToInProcessRefusal(artifacts);
    }
    const { plan, bwrapPlan } = artifacts;

    let child;
    try {
      child = spawn(bwrapPlan, {
        env: plan.env,

        stdio: ["ignore", "pipe", "pipe"],
        detached: false
      });
    } catch (err) {
      if (
        err instanceof BubblewrapIsolationError
        && CODEX_SANDBOX_DECISION_BWRAP_DIAGNOSTIC_CODES.has(err.code)
      ) {

        const failOpenPlan = buildWorkspaceAgentFailOpenPlan({
          launchFacts: {
            command: plan.command,
            args: plan.args,
            cwd: planCwd,
            env: plan.env
          },
          role,
          subject,
          workspaceDir: planCwd,
          resolveUnsandboxedOptIn,
          probeCanonicalBwrapAvailability: () =>
            bwrapAvailabilityFromCodexIsolationError(err)
        });
        const lateFinalPath = typeof plan.finalPath === "string" && plan.finalPath.length > 0
          ? plan.finalPath
          : null;
        const lateLogPath = typeof plan.logPath === "string" && plan.logPath.length > 0
          ? plan.logPath
          : null;
        if (
          failOpenPlan?.sandbox_decision?.outcome
            === WORKSPACE_AGENT_SANDBOX_OUTCOMES.UNENFORCED_PLAIN_LAUNCH
          && failOpenPlan.disposition
            === WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN
        ) {
          const failOpenLaunchPlan = failOpenPlan.plan ?? {};
          return launchWorkspaceAgentFamilyLaunchLifecycle({
            command: failOpenLaunchPlan.command,
            args: failOpenLaunchPlan.args,
            cwd: failOpenLaunchPlan.cwd,
            env: failOpenLaunchPlan.env,
            options: {
              stdio: ["ignore", "pipe", "pipe"],
              detached: false
            },
            spawn: plainSpawn,
            superviseChildLaunch,
            parseFinalResult: ({ status, exit, finalPath: fp, logPath: lp, codexRole: cr, stderr }) =>
              captureFinalResult({ status, exit, finalPath: fp, logPath: lp, role, codexRole: cr, subject, workspaceDir, stderr, env }),
            role,
            subject,
            kind: "codex",
            killTimeoutMs,
            passthrough: { finalPath: lateFinalPath, logPath: lateLogPath, codexRole, workspaceDir },
            warning: failOpenPlan.warning,
            enforcement: failOpenPlan.enforcement,
            buildSpawnThrewRefusal: (detail) =>
              makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, "plain_spawn_threw", detail),
            buildNoChildRefusal: () =>
              makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, "plain_spawn_no_child", null),
            adaptSupervisedResult: (supervised) =>
              attachProvenanceToSupervisedResult(supervised, {
                finalPath: lateFinalPath,
                logPath: lateLogPath,
                env: failOpenLaunchPlan.env,
                sandboxDecision: failOpenPlan.sandbox_decision
              })
          });
        }
        return buildCodexFailOpenClosedRefusal(failOpenPlan);
      }
      if (err instanceof BubblewrapIsolationError) {
        return makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "bubblewrap_spawn_failed",
          { code: err.code, message: err.message }
        );
      }
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "spawn_isolated_threw",
        { message: err?.message ?? String(err) }
      );
    }

    if (!child || typeof child !== "object") {
      return makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "spawn_isolated_no_child",
        null
      );
    }

    const finalPath = typeof plan.finalPath === "string" && plan.finalPath.length > 0
      ? plan.finalPath
      : null;
    const logPath = typeof plan.logPath === "string" && plan.logPath.length > 0
      ? plan.logPath
      : null;

    const supervised = superviseChildLaunch({
      child,
      parseFinalResult: ({ status, exit, finalPath: fp, logPath: lp, codexRole: cr, stderr }) =>
        captureFinalResult({ status, exit, finalPath: fp, logPath: lp, role, codexRole: cr, subject, workspaceDir, stderr, env }),
      role,
      subject,
      family: "codex",

      killTimeoutMs,
      passthrough: { finalPath, logPath, codexRole, workspaceDir }
    });

    return attachProvenanceToSupervisedResult(supervised, { finalPath, logPath, env });
  };
}

export function createHostWriteAuthorityBrokerPlanLaunch({
  buildPlan = buildCodexRolePlan,
  buildBwrapPlan = buildCodexRoleBubblewrapPlan,
  ensureWriteRoots = ensureNewWorkerWriteRoots,
  env = process.env,
  cwd: defaultCwd = process.cwd(),
  promptArgs = [],
  resolvedProfile = null,
  prepareSourceToolSurface = null,
  captureFinalResult = defaultCaptureCodexFinalResult,

  resolveSchemaConstrainedTier = resolveLauncherSchemaConstrainedTierIsPaid,
  loadWorkRecord = loadWorkRecordById
} = {}) {
  const brokerSourceSurfacePreparer = typeof prepareSourceToolSurface === "function"
    ? prepareSourceToolSurface
    : createLauncherOwnedSourceToolSurfacePreparer({ env, cwd: defaultCwd });
  return async function brokerPlanLaunch(launchInput) {
    const codexRole = typeof launchInput?.codex_role === "string"
      ? launchInput.codex_role
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

    const brokerSourceSurfacePolicy = await resolveCodexWorkerSourceSurfacePolicy({
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
        model: launchInput?.model ?? null
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
    const sourceToolSurface = brokerSourceSurfacePolicy.forwardedSourceToolSurface;

    const brokerModelGate = await evaluateDispatchRoleModelGate({
      role: codexRole,
      isWorker: codexRole === "worker",
      resolvedProfile,
      modelHint: launchInput?.model,
      cwd: workspaceDir ?? defaultCwd
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
        loadWorkRecord
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

    const brokerSchemaConstrainedTierIsPaid = workspaceDir
      ? resolveSchemaConstrainedTier({ workspaceDir }) === true
      : false;
    const terminalStructuredRoleResultMode = resolveCodexTerminalStructuredRoleResultMode({
      schemaConstrainedTierIsPaid: brokerSchemaConstrainedTierIsPaid,
      codexRole
    });

    const artifacts = await buildCodexLaunchArtifacts({
      planArgs: {
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

        terminalStructuredRoleResultMode
      },
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

export const __TERMINAL_STATUSES_FOR_TESTS = __LAUNCH_CORE_TERMINAL_STATUSES_FOR_TESTS;
