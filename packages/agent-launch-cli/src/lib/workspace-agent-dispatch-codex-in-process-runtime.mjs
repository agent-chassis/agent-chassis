import { BACKEND_REFUSAL_CODES } from "./workspace-agent-dispatch-backend.mjs";
import { isRuntimeBlockerCode } from
  "@agent-chassis/wiki-core/src/lib/runtime-blocker-taxonomy.mjs";
import { superviseChildLaunch } from "./workspace-agent-launch-core.mjs";
import { BubblewrapIsolationError } from "./launch-isolation.mjs";
import { assertGitMetadataProjectionComposed } from "./launch-isolation-findings-git-metadata.mjs";
import { attachStdioMcpConduitLaunchOutcome } from "./stdio-mcp-conduit-contract.mjs";
import {
  buildConduitSpawnFailureRefusal,
  buildLaunchPathFailureRefusal,
  buildWorkerTestRuntimePreparationRefusal,
  classifyLaunchPathFailure,
  classifyWorkerTestRuntimePreparationFailure,
  cleanupConduitForRefusal
} from "./launch-failure-cause.mjs";
import {
  assertCodexWorkerCommitCredentialBinding,
  injectCodexConfigOverridesBeforeFinalPositional
} from "./codex-role-mcp-env.mjs";
import {
  buildCodexStdioMcpRegistrationOverrides,
  CODEX_REQUIRED_MCP_CONDUIT_ABSENT_REASON,
  resolveCodexConduitInput
} from "./codex-conduit-binding.mjs";
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
  createLauncherObservedDispatchEnforcementForConfirmedIsolatedSpawn
} from "./workspace-agent-dispatch-provenance.mjs";
import {
  PRECREATION_CLEANUP_IDENTITY_DRIFT_REASON,
  createAttemptPrecreatedResourceOwner
} from "./pre-spawn-cleanup-binding.mjs";
import {
  buildCodexDispatchWorkerPlanArgs
} from "./workspace-agent-dispatch-codex-plan-args.mjs";
import {
  attachCodexModelRoute,
  liteLlmRouteFailureDetail
} from "./litellm-gateway-launch.mjs";
import { selectWorkerLifecycleFromEffectiveWriteScope } from
  "./workspace-agent-worker-lifecycle.mjs";

let plainChildProcessSpawn = null;

export async function resolvePlainChildProcessSpawn() {
  if (plainChildProcessSpawn === null) {
    const childProcess = await import("node:" + "child_process");
    plainChildProcessSpawn = childProcess.spawn;
  }
  const spawnNow = plainChildProcessSpawn;

  return (command, args, options) =>
    spawnNow(command, Array.isArray(args) ? [...args] : [], options);
}

export async function spawnPlainChildProcess(command, args, options) {
  const spawnNow = await resolvePlainChildProcessSpawn();
  return spawnNow(command, args, options);
}

function resolveCodexPlainSpawnPrimitive(plainSpawn) {
  return plainSpawn === spawnPlainChildProcess
    ? resolvePlainChildProcessSpawn
    : async () => plainSpawn;
}

function adoptCodexFirstPlan(attemptResources, bwrapPlan) {
  try {
    attemptResources.adopt(bwrapPlan);
    return null;
  } catch {
    return attemptResources.settle(makeRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      PRECREATION_CLEANUP_IDENTITY_DRIFT_REASON,
      attemptResources.ownershipRefusal
    ));
  }
}

export const CODEX_SECOND_COMPOSITION_OWNED_RESOURCES_REASON =
  "codex_second_composition_created_resources";

function assertSecondCompositionOwnsNothing(bwrapPlan) {
  const capability = bwrapPlan?.writableFilePrecreationCleanup ?? null;
  const entries = Array.isArray(capability?.entries) ? capability.entries : [];
  if (entries.length === 0) return;
  capability.cleanup();
  const error = new Error("the second Codex sandbox composition created resources the first plan did not own");
  error.code = CODEX_SECOND_COMPOSITION_OWNED_RESOURCES_REASON;
  error.detail = Object.freeze({ owned_entry_count: entries.length, authority_limb: "mechanical_failure" });
  throw error;
}

export async function launchCodexWorkspaceAgentInProcess(options) {
  const route = { attachment: null, childStarted: false };
  try {
    return await launchCodexWithModelRoute(options, route);
  } finally {
    if (!route.childStarted) route.attachment?.release();
  }
}

function releaseRouteWithChild(route, child) {
  if (route.attachment === null || child === null || typeof child !== "object" ||
      typeof child.once !== "function") {
    return child;
  }
  route.childStarted = true;
  const release = () => route.attachment.release();
  child.once("exit", release);
  child.once("error", release);
  return child;
}

async function launchCodexWithModelRoute({
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
  probeCanonicalBwrapAvailability,
  createMcpConduit,
  attachModelRoute = attachCodexModelRoute
}, route) {

  const attachRoute = async (plan) => {
    try {
      route.attachment = await attachModelRoute(plan, { env });
      return null;
    } catch (error) {
      const failure = liteLlmRouteFailureDetail(error);
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, failure.code, {
        ...failure,
        authority_limb: "mechanical_failure"
      });
    }
  };
  const routedSpawn = (...spawnArgs) => releaseRouteWithChild(route, spawn(...spawnArgs));
  const routedPlainSpawn = () => {
    const resolve = resolveCodexPlainSpawnPrimitive(plainSpawn);
    return async () => {
      const primitive = await resolve();
      return typeof primitive === "function"
        ? async (...spawnArgs) => releaseRouteWithChild(route, await primitive(...spawnArgs))
        : primitive;
    };
  };
  const advisoryReview = input?.advisory_review_input !== undefined;
  let lifecycleKind = "advisory";
  if (!advisoryReview) {
    try {
      lifecycleKind = selectWorkerLifecycleFromEffectiveWriteScope(
        input?.canonical_unit_write_scope
      );
    } catch (error) {
      return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
        error?.code ?? "launcher_effective_write_scope_invalid",
        { subject, authority_limb: "mechanical_failure" });
    }
  }

  const artifacts = await buildCodexLaunchArtifacts({
    planArgs: buildCodexDispatchWorkerPlanArgs({
      role: codexRole,
      subject,
      promptArgs,
      env,
      cwd: planCwd,

      resolvedProfile: effectiveResolvedProfile,
      workspaceAlias,
      workspaceDir,

      sourceToolSurface: forwardedSourceToolSurface,

      terminalStructuredRoleResultMode,
      dispatchWorktreeRoot: input?.dispatchWorktreeRoot ?? null,
      provisionedWorktreeGitBinding: input?.provisionedWorktreeGitBinding ?? null,
      provisioned_worktree_git_binding: input?.provisioned_worktree_git_binding ?? null,
      worker_scope_authority: input?.worker_scope_authority ?? null,
      worktree_provisioning: input?.worktree_provisioning ?? null,
      dispatchWorkspaceBinding: input?.dispatch_workspace_binding ?? null,
      advisoryReviewInput: input?.advisory_review_input ?? null,

      workerAssignment: input?.worker_assignment ?? null
    }),
    buildPlan,
    buildBwrapPlan,
    ensureWriteRoots,
    assertBwrap
  });

  const attemptResources = createAttemptPrecreatedResourceOwner({
    role: codexRole,
    subject,
    runId: input?.run_id ?? null
  });
  const cleanupIdentityRefusal = adoptCodexFirstPlan(attemptResources, artifacts.bwrapPlan);
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
        return attemptResources.settle(makeRefusal(
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
        return attemptResources.settle(makeRefusal(
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
        const plainRouteRefusal = route.attachment === null ? await attachRoute(artifacts.plan) : null;
        if (plainRouteRefusal !== null) {
          return attemptResources.settle(plainRouteRefusal);
        }
        if (Array.isArray(failOpenLaunchPlan.args) && failOpenLaunchPlan.args !== artifacts.plan.args) {
          injectCodexConfigOverridesBeforeFinalPositional(failOpenLaunchPlan.args, [...route.attachment.overrides]);
        }
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
          resolveSpawn: routedPlainSpawn(),
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
          : attemptResources.settle(plainLaunch);
      }
      return attemptResources.settle(buildCodexFailOpenClosedRefusal(failOpenPlan));
    }
    return attemptResources.settle(mapCodexArtifactsFailureToInProcessRefusal(artifacts));
  }
  const plan = artifacts.plan;
  let bwrapPlan = artifacts.bwrapPlan;

  let conduit = null;
  try {
    if (typeof createMcpConduit !== "function") {
      return attemptResources.settle(makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        CODEX_REQUIRED_MCP_CONDUIT_ABSENT_REASON,
        { role: codexRole, subject, unenforced_fallback_permitted: false }
      ));
    }
    const provisioning = input?.worktree_provisioning ?? null;
    const canonicalReviewerRoot = input?.advisory_review_input?.repository ?? null;
    const commitTuple = role === "worker" && provisioning !== null
      ? assertCodexWorkerCommitCredentialBinding({
          assignedUnit: subject,
          managedWorker: true,
          worktreeProvisioning: provisioning,
          sliceBinding: provisioning.slice_binding
        })
      : null;

    conduit = await createMcpConduit(resolveCodexConduitInput({
      role: codexRole,
      assignedUnit: subject,

      workspaceDir: input?.advisory_review_input !== undefined
        ? canonicalReviewerRoot
        : provisioning?.main_repo ?? workspaceDir ?? planCwd,
      workerScopeAuthority: bwrapPlan?.workerScopeAuthority ?? null,
      worktreeProvisioning: provisioning,
      commitTuple,

      completionCredential: input?.completion_credential ??
        input?.completionCredential ??
        input?.readiness?.completion_credential ??
        input?.readiness?.completionCredential ?? null,

      workerAssignment: input?.worker_assignment ?? null,

      advisoryReviewInput: input?.advisory_review_input ?? null,
      launcherEnv: env,
      requested: {
        read_scope: input?.read_scope ?? null,
        write_scope: input?.write_scope ?? null,
        workspace_alias: workspaceAlias ?? null,
        dispatch_worktree_root: input?.dispatchWorktreeRoot ?? null
      }
    }));
    injectCodexConfigOverridesBeforeFinalPositional(
      plan.args,
      buildCodexStdioMcpRegistrationOverrides(conduit)
    );
    const routeRefusal = await attachRoute(plan);
    if (routeRefusal !== null) {
      const conduitCleanupFailure = await cleanupConduitForRefusal(conduit);
      return attemptResources.settle(conduitCleanupFailure === null
        ? routeRefusal
        : { ...routeRefusal, refusal: { ...routeRefusal.refusal,
          detail: { ...routeRefusal.refusal.detail, conduit_cleanup_failures: conduitCleanupFailure } } });
    }
    bwrapPlan = buildBwrapPlan(plan, { stdioMcpConduit: conduit });
    assertSecondCompositionOwnsNothing(bwrapPlan);
    if (input?.advisory_review_input !== undefined) {
      assertGitMetadataProjectionComposed(bwrapPlan, {
        checkout: input.advisory_review_input.private_checkout_root
      });
    }
    assertBwrap({ env: plan.env, bwrapPath: bwrapPlan.bwrapPath });
  } catch (error) {
    const conduitCleanupFailure = conduit ? await cleanupConduitForRefusal(conduit) : null;
    const pathFailure = classifyLaunchPathFailure(error);
    return attemptResources.settle(pathFailure !== null
      ? buildLaunchPathFailureRefusal(makeRefusal, pathFailure, {
          conduit_cleanup_failures: conduitCleanupFailure
        })

      : makeRefusal(
          isRuntimeBlockerCode(error?.code)
            ? error.code
            : BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
          error?.code ?? "codex_stdio_mcp_conduit_failed",
          {
            message: error?.message ?? String(error),
            detail: error?.detail ?? null,
            ...(error instanceof BubblewrapIsolationError ? { authority_limb: "mechanical_failure" } : {}),
            ...(conduitCleanupFailure === null ? {} : { conduit_cleanup_failures: conduitCleanupFailure })
          }
        ));
  }

  let child;
  try {
    child = routedSpawn(bwrapPlan, {
      env: plan.env,

      stdio: ["ignore", "pipe", "pipe"],
      detached: false
    });
  } catch (err) {

    if (conduit !== null) {
      const conduitCleanupFailure = await cleanupConduitForRefusal(conduit);
      return attemptResources.settle(
        buildConduitSpawnFailureRefusal(makeRefusal, err, conduitCleanupFailure));
    }
    const preparation = classifyWorkerTestRuntimePreparationFailure(err);
    if (preparation !== null) {
      return attemptResources.settle(buildWorkerTestRuntimePreparationRefusal(makeRefusal, preparation));
    }
    const pathFailure = classifyLaunchPathFailure(err);
    if (pathFailure !== null) {
      return attemptResources.settle(buildLaunchPathFailureRefusal(makeRefusal, pathFailure));
    }
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
        return attemptResources.settle(makeRefusal(
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
        return attemptResources.settle(makeRefusal(
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
        const plainRouteRefusal = route.attachment === null ? await attachRoute(plan) : null;
        if (plainRouteRefusal !== null) {
          return attemptResources.settle(plainRouteRefusal);
        }
        if (Array.isArray(failOpenLaunchPlan.args) && failOpenLaunchPlan.args !== plan.args) {
          injectCodexConfigOverridesBeforeFinalPositional(failOpenLaunchPlan.args, [...route.attachment.overrides]);
        }
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
          resolveSpawn: routedPlainSpawn(),
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
          : attemptResources.settle(plainLaunch);
      }
      return attemptResources.settle(buildCodexFailOpenClosedRefusal(failOpenPlan));
    }
    if (err instanceof BubblewrapIsolationError) {
      return attemptResources.settle(makeRefusal(
        BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
        "bubblewrap_spawn_failed",
        {
          code: err.code,
          message: err.message,
          detail: err.detail ?? null,
          authority_limb: "mechanical_failure"
        }
      ));
    }
    return attemptResources.settle(makeRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      "spawn_isolated_threw",
      { message: err?.message ?? String(err) }
    ));
  }

  if (!child || typeof child !== "object") {
    return attemptResources.settle(makeRefusal(
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

  return attemptResources.settle(attachStdioMcpConduitLaunchOutcome(
    attachProvenanceToSupervisedResult(supervised, {
      finalPath,
      logPath,
      env,
      enforcement:
        createLauncherObservedDispatchEnforcementForConfirmedIsolatedSpawn()
    }),
    conduit,
    (failure) => makeRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START,
      failure.reason,
      failure.detail
    )
  ), child);
}
