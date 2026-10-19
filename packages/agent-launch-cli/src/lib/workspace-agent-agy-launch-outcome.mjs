import { prepareNativeUsageLaunch } from "@agent-chassis/agent-launch-core/src/lib/native-usage-records.mjs";
import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";
import { buildFamilyModelRefusal } from "./workspace-agent-family-policy.mjs";
import { buildConduitSpawnFailureRefusal, cleanupConduitForRefusal } from "./launch-failure-cause.mjs";
import { attachStdioMcpConduitLaunchOutcome, settleStdioMcpConduitCleanup,
  STDIO_MCP_CONDUIT_RUN_TIMEOUT_MS } from "./stdio-mcp-conduit-contract.mjs";
import { superviseChildLaunch } from "./workspace-agent-launch-core.mjs";
import { launchWorkspaceAgentFamilyLaunchLifecycle } from "./workspace-agent-family-launch-lifecycle.mjs";
import { spawnIsolated } from "./launch-isolation.mjs";
import { buildAgyBwrapPlan } from "./workspace-agent-agy-launch-runtime.mjs";
import { captureAgyFinalResult } from "./workspace-agent-agy-launch-support.mjs";
import { buildStructuredDispatchProvenance, createLauncherObservedDispatchEnforcementForConfirmedIsolatedSpawn }
  from "./workspace-agent-dispatch-provenance.mjs";
import { attachDispatchProvenanceToSupervisedResult } from "./workspace-agent-inprocess-launch-policy.mjs";
import { assertGitMetadataProjectionComposed } from "./launch-isolation-findings-git-metadata.mjs";

const refuse = (code, reason, detail) => buildFamilyModelRefusal({ code, reason, detail });

export async function launchAgy(context) {
  const { input, prepared, runtime, conduit, resources, options } = context;
  const nativeUsage = prepareNativeUsageLaunch({ family: "agy", args: prepared.commandLine.args,
    workspaceDir: context.advisory?.repository ?? input.worktree_provisioning?.main_repo ?? input.workspace_dir,
    env: runtime.env, resumed: false,
    identity: { repo: context.advisory?.repository ?? input.worktree_provisioning?.main_repo ?? input.workspace_dir,
      run_id: input.run_id, attempt_id: input.run_id, subject: input.subject, role: input.role,
      route: "dispatched_role", mode: "headless" } });
  let child = null;
  let spawnFailure = null;
  const supervised = await launchWorkspaceAgentFamilyLaunchLifecycle({
    ...prepared.commandLine, command: prepared.commandLine.command, args: prepared.commandLine.args,
    cwd: input.workspace_dir, env: runtime.env, role: input.role, subject: input.subject, kind: "agy",
    options: { stdio: ["ignore", "pipe", "pipe"] },
    spawn: async () => {
      try {
        const plan = buildAgyBwrapPlan(context);
        resources.adopt(plan);
        if (context.advisory !== null) assertGitMetadataProjectionComposed(plan, { checkout: input.workspace_dir });
        child = await (options.spawnIsolated ?? spawnIsolated)(plan,
          { env: runtime.env, stdio: ["ignore", "pipe", "pipe"] });
        return child;
      } catch (error) {
        spawnFailure = error;
        throw error;
      }
    },
    stdoutTap: nativeUsage.tap,
    superviseChildLaunch, parseFinalResult: facts => captureAgyFinalResult({ ...facts,
      role: input.role, subject: input.subject, schema: prepared.schema }),
    killTimeoutMs: options.killTimeoutMs ?? STDIO_MCP_CONDUIT_RUN_TIMEOUT_MS,
    buildSpawnThrewRefusal: async detail => buildConduitSpawnFailureRefusal(refuse,
      spawnFailure ?? Object.assign(new Error(detail.message), detail), await cleanupConduitForRefusal(conduit)),
    buildNoChildRefusal: async () => {
      const cleanup = await cleanupConduitForRefusal(conduit);
      return refuse(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, "agy_spawn_no_child",
        { conduit_cleanup_failure: cleanup?.detail ?? null });
    },
    adaptSupervisedResult: result => attachDispatchProvenanceToSupervisedResult(result, final => ({ ...final,
      provenance: buildStructuredDispatchProvenance({ runId: input.run_id, monitorHandle: input.monitor_handle,
        role: input.role, subject: input.subject, app: "agy", transcriptSource: "child_process_stdout",
        enforcement: createLauncherObservedDispatchEnforcementForConfirmedIsolatedSpawn() }) }))
  });
  const settled = resources.settle(supervised, child);
  if (settled.accepted !== true) return settled;
  const outcome = attachStdioMcpConduitLaunchOutcome(settled, conduit);

  await conduit.clientReady.then(() => undefined, () => settleStdioMcpConduitCleanup(conduit));
  return outcome;
}
