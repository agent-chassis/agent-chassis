import { BACKEND_REFUSAL_CODES } from "./workspace-agent-dispatch-backend.mjs";
import { superviseChildLaunch } from "./workspace-agent-launch-core.mjs";
import { BubblewrapIsolationError } from "./launch-isolation.mjs";
import {
  WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS,
  buildWorkspaceAgentFailOpenPlan
} from "./launch-isolation-failopen.mjs";
import {
  WORKSPACE_AGENT_SANDBOX_OUTCOMES
} from "./workspace-agent-sandbox-decision.mjs";
import { launchWorkspaceAgentFamilyLaunchLifecycle } from "./workspace-agent-family-launch-lifecycle.mjs";
import {
  CODEX_SANDBOX_DECISION_BWRAP_DIAGNOSTIC_CODES,
  buildCodexFailOpenClosedRefusal,
  buildCodexLaunchArtifacts,
  bwrapAvailabilityFromCodexIsolationError,
  makeRefusal,
  mapCodexArtifactsFailureToInProcessRefusal
} from "./workspace-agent-dispatch-codex-launch-support.mjs";
import {
  attachProvenanceToSupervisedResult
} from "./workspace-agent-dispatch-codex-provenance.mjs";
import {
  bindAttemptOwnedPreSpawnCleanup
} from "./host-write-authority-substrate/broker.mjs";
import {
  buildCodexDispatchWorkerPlanArgs
} from "./workspace-agent-dispatch-codex-plan-args.mjs";
import {
  renderTrustedCorrectiveFindingsInstructions
} from "./workspace-agent-launch-adapter-contract.mjs";

export async function spawnPlainChildProcess(command, args, options) {
  const childProcess = await import("node:" + "child_process");
  return childProcess.spawn(command, Array.isArray(args) ? [...args] : [], options);
}

function cleanupFailureRefusal(controller, error) {
  return makeRefusal(
    BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
    "writable_file_precreation_cleanup_failed",
    {
      attempt_id: controller?.attempt_id ?? null,
      run_id: controller?.run_id ?? null,
      unit_address: controller?.unit_address ?? null,
      message: error?.message ?? String(error)
    }
  );
}

function compensateCodexPreSpawnRefusal(controller, refusal) {
  if (controller === null) return refusal;
  try {
    controller.cleanupOnce();
  } catch (error) {
    return cleanupFailureRefusal(controller, error);
  }
  return refusal;
}

function assertCodexPreSpawnCleanupIdentity(controller) {
  if (controller === null || controller.valid === true) return null;
  return compensateCodexPreSpawnRefusal(controller, makeRefusal(
    BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
    "writable_file_precreation_cleanup_identity_drift",
    {
      attempt_id: controller.attempt_id,
      run_id: controller.run_id,
      unit_address: controller.unit_address
    }
  ));
}

export async function launchCodexWorkspaceAgentInProcess({
  input,
  role,
  subject,
  codexRole,
  promptArgs,
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
}) {
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

  const artifacts = await buildCodexLaunchArtifacts({
    planArgs: buildCodexDispatchWorkerPlanArgs({
      role: codexRole,
      subject,
      promptArgs: correctiveInstructions === null
        ? promptArgs
        : [...promptArgs, correctiveInstructions],
      env,
      cwd: planCwd,

      resolvedProfile: effectiveResolvedProfile,
      workspaceAlias,
      workspaceDir,
      acceptanceCriteria: findingsOnlyAcceptance?.acceptanceCriteria ?? [],
      acceptanceValidation: findingsOnlyAcceptance?.acceptanceValidation ?? [],

      sourceToolSurface: forwardedSourceToolSurface,

      terminalStructuredRoleResultMode,
      dispatchWorktreeRoot: input?.dispatchWorktreeRoot ?? null,
      provisionedWorktreeGitBinding: input?.provisionedWorktreeGitBinding ?? null,
      provisioned_worktree_git_binding: input?.provisioned_worktree_git_binding ?? null,
      worker_scope_authority: input?.worker_scope_authority ?? null,
      worktree_provisioning: input?.worktree_provisioning ?? null,

      configRootDir: input?.config_root_dir ?? input?.readiness?.config_root_dir ?? null,
      trustedFrozenReviewContract: input?.trusted_frozen_review_contract ??
        input?.readiness?.trusted_frozen_review_contract ?? null
    }),
    buildPlan,
    buildBwrapPlan,
    ensureWriteRoots,
    assertBwrap
  });
  const cleanupController = bindAttemptOwnedPreSpawnCleanup({
    bwrapPlan: artifacts.bwrapPlan,
    role: codexRole,
    subject,
    runId: input?.run_id ?? null
  });
  const cleanupIdentityRefusal = assertCodexPreSpawnCleanupIdentity(cleanupController);
  if (cleanupIdentityRefusal !== null) {
    return cleanupIdentityRefusal;
  }
  if (!artifacts.ok) {
    if (artifacts.stage === "assert_bwrap_isolation") {

      let failOpenPlan;
      try {
        failOpenPlan = buildWorkspaceAgentFailOpenPlan({
          launchFacts: {
            command: artifacts.plan?.command,
            args: artifacts.plan?.args,
            cwd: planCwd,
            env: artifacts.plan?.env
          },
          role,
          subject,
          workspaceDir: planCwd,
          workerScopeAuthority: artifacts.bwrapPlan?.workerScopeAuthority ?? null,
          resolveUnsandboxedOptIn,
          classifyIsolationBackendAvailability,
          probeCanonicalBwrapAvailability
        });
      } catch (error) {
        return compensateCodexPreSpawnRefusal(cleanupController, makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "codex_fail_open_plan_threw",
          { message: error?.message ?? String(error) }
        ));
      }
      const finalPath = typeof artifacts.plan?.finalPath === "string" && artifacts.plan.finalPath.length > 0
        ? artifacts.plan.finalPath
        : null;
      const logPath = typeof artifacts.plan?.logPath === "string" && artifacts.plan.logPath.length > 0
        ? artifacts.plan.logPath
        : null;
      if (
        artifacts.bwrapPlan?.workerScopeAuthority != null &&
        failOpenPlan?.disposition === WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN
      ) {
        return compensateCodexPreSpawnRefusal(cleanupController, makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          "managed_worker_plain_spawn_forbidden",
          { issue: "containment_authority_drift" }
        ));
      }
      if (
        failOpenPlan?.sandbox_decision?.outcome
          === WORKSPACE_AGENT_SANDBOX_OUTCOMES.UNENFORCED_PLAIN_LAUNCH
        && failOpenPlan.disposition
          === WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN
      ) {
        const failOpenLaunchPlan = failOpenPlan.plan ?? {};
        const plainLaunch = await launchWorkspaceAgentFamilyLaunchLifecycle({
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
        return plainLaunch?.accepted === true
          ? plainLaunch
          : compensateCodexPreSpawnRefusal(cleanupController, plainLaunch);
      }
      return compensateCodexPreSpawnRefusal(
        cleanupController,
        buildCodexFailOpenClosedRefusal(failOpenPlan)
      );
    }
    return compensateCodexPreSpawnRefusal(
      cleanupController,
      mapCodexArtifactsFailureToInProcessRefusal(artifacts)
    );
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

      let failOpenPlan;
      try {
        failOpenPlan = buildWorkspaceAgentFailOpenPlan({
          launchFacts: {
            command: plan.command,
            args: plan.args,
            cwd: planCwd,
            env: plan.env
          },
          role,
          subject,
          workspaceDir: planCwd,
          workerScopeAuthority: bwrapPlan.workerScopeAuthority ?? null,
          resolveUnsandboxedOptIn,
          probeCanonicalBwrapAvailability: () =>
            bwrapAvailabilityFromCodexIsolationError(err)
        });
      } catch (error) {
        return compensateCodexPreSpawnRefusal(cleanupController, makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          "codex_fail_open_plan_threw",
          { message: error?.message ?? String(error) }
        ));
      }
      const lateFinalPath = typeof plan.finalPath === "string" && plan.finalPath.length > 0
        ? plan.finalPath
        : null;
      const lateLogPath = typeof plan.logPath === "string" && plan.logPath.length > 0
        ? plan.logPath
        : null;
      if (
        bwrapPlan.workerScopeAuthority != null &&
        failOpenPlan?.disposition === WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN
      ) {
        return compensateCodexPreSpawnRefusal(cleanupController, makeRefusal(
          BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
          "managed_worker_plain_spawn_forbidden",
          { issue: "containment_authority_drift" }
        ));
      }
      if (
        failOpenPlan?.sandbox_decision?.outcome
          === WORKSPACE_AGENT_SANDBOX_OUTCOMES.UNENFORCED_PLAIN_LAUNCH
        && failOpenPlan.disposition
          === WORKSPACE_AGENT_FAIL_OPEN_DISPOSITIONS.PLAIN_SPAWN
      ) {
        const failOpenLaunchPlan = failOpenPlan.plan ?? {};
        const plainLaunch = await launchWorkspaceAgentFamilyLaunchLifecycle({
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
        return plainLaunch?.accepted === true
          ? plainLaunch
          : compensateCodexPreSpawnRefusal(cleanupController, plainLaunch);
      }
      return compensateCodexPreSpawnRefusal(
        cleanupController,
        buildCodexFailOpenClosedRefusal(failOpenPlan)
      );
    }
    if (err instanceof BubblewrapIsolationError) {
      return compensateCodexPreSpawnRefusal(cleanupController, makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "bubblewrap_spawn_failed",
        { code: err.code, message: err.message }
      ));
    }
    return compensateCodexPreSpawnRefusal(cleanupController, makeRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      "spawn_isolated_threw",
      { message: err?.message ?? String(err) }
    ));
  }

  if (!child || typeof child !== "object") {
    return compensateCodexPreSpawnRefusal(cleanupController, makeRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      "spawn_isolated_no_child",
      null
    ));
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
}
