

import {
  BACKEND_REFUSAL_CODES
} from "./workspace-agent-dispatch-backend.mjs";
import {
  BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES,
  BubblewrapIsolationError
} from "./launch-isolation.mjs";
import {
  buildConduitSpawnFailureRefusal,
  buildLaunchPathFailureRefusal,
  buildWorkerTestRuntimePreparationRefusal,
  classifyLaunchPathFailure,
  classifyWorkerTestRuntimePreparationFailure,
  cleanupConduitForRefusal
} from "./launch-failure-cause.mjs";
import {
  STDIO_MCP_CONDUIT_RUN_TIMEOUT_MS,
  attachStdioMcpConduitLaunchOutcome,
  settleStdioMcpConduitCleanup
} from "./stdio-mcp-conduit-contract.mjs";
import { superviseChildLaunch } from "./workspace-agent-launch-core.mjs";
import { launchWorkspaceAgentFamilyLaunchLifecycle } from "./workspace-agent-family-launch-lifecycle.mjs";
import {
  createLauncherObservedDispatchEnforcementForConfirmedIsolatedSpawn
} from "./workspace-agent-dispatch-provenance.mjs";
import { attachDispatchProvenanceToSupervisedResult } from "./workspace-agent-inprocess-launch-policy.mjs";
import {
  isClaudeCredentialsReadOnlyFileRefusal,
  makeRefusal
} from "./workspace-agent-claude-launch-support.mjs";
import {
  WORKSPACE_AGENT_SANDBOX_OUTCOMES,
  buildClaudeSandboxDecisionFromIsolationFailure,
  buildClaudeSandboxDecisionRefusal,
  buildClaudeSupervisedFinalResultWithProvenance,
  buildClaudeWriteScopeVerificationFailure,
  resolveClaudePlainSpawnPrimitive
} from "./workspace-agent-claude-run-shaping.mjs";

function buildClaudePostRunVerification({
  needsDirectoryScope,
  verifyWorkerWriteScope,
  workspaceDir,
  writeScope,
  writeScopeBaseline
}) {
  if (!needsDirectoryScope) return null;
  return {
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
  };
}

export async function resolveClaudeSpawnFailureOutcome(err, ctx) {
  const {
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
    killTimeoutMs
  } = ctx;
  if (conduit) {

    const conduitCleanupFailure = await cleanupConduitForRefusal(conduit);
    return buildConduitSpawnFailureRefusal(makeRefusal, err, conduitCleanupFailure);
  }

  const preparation = classifyWorkerTestRuntimePreparationFailure(err);
  if (preparation !== null) return buildWorkerTestRuntimePreparationRefusal(makeRefusal, preparation);
  if (isClaudeCredentialsReadOnlyFileRefusal(err)) {
    return makeRefusal(
      BACKEND_REFUSAL_CODES.LAUNCH_REFUSED,
      "claude_executor_credentials_path_invalid",
      err.detail ?? null
    );
  }

  if (err instanceof BubblewrapIsolationError && (
    err.code === BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FINDINGS_GIT_METADATA_INVALID ||
    err.code === BUBBLEWRAP_ISOLATION_DIAGNOSTIC_CODES.FINDINGS_GIT_METADATA_CHANGED
  )) {
    return makeRefusal(BACKEND_REFUSAL_CODES.LAUNCH_REFUSED, "bubblewrap_plan_refused", {
      code: err.code,
      message: err.message,
      detail: err.detail ?? null,
      authority_limb: "mechanical_failure"
    });
  }

  const pathFailure = classifyLaunchPathFailure(err);
  if (pathFailure !== null) {
    return buildLaunchPathFailureRefusal(makeRefusal, pathFailure);
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

        resolveSpawn: resolveClaudePlainSpawnPrimitive(plainSpawn),
        postRunVerification: buildClaudePostRunVerification(ctx),
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

export async function settleClaudeSupervisedLaunch(ctx) {
  const {
    child,
    commandLine,
    argv,
    captureFinalResult,
    role,
    subject,
    conduit,
    killTimeoutMs,
    resolvedClaudePath,
    workspaceDir
  } = ctx;
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
    postRunVerification: buildClaudePostRunVerification(ctx),

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
}
