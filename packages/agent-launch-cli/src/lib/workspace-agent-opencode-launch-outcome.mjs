import { prepareNativeUsageLaunch } from "@agent-chassis/agent-launch-core/src/lib/native-usage-records.mjs";
import { BACKEND_REFUSAL_CODES } from "@agent-chassis/agent-launch-core";
import { buildFamilyModelRefusal } from "./workspace-agent-family-policy.mjs";
import { buildConduitSpawnFailureRefusal, cleanupConduitForRefusal } from "./launch-failure-cause.mjs";
import { attachStdioMcpConduitLaunchOutcome, settleStdioMcpConduitCleanup,
  STDIO_MCP_CONDUIT_RUN_TIMEOUT_MS } from "./stdio-mcp-conduit-contract.mjs";
import { superviseChildLaunch } from "./workspace-agent-launch-core.mjs";
import { launchWorkspaceAgentFamilyLaunchLifecycle } from "./workspace-agent-family-launch-lifecycle.mjs";
import { spawnIsolated } from "./launch-isolation.mjs";
import { buildOpenCodeBwrapPlan } from "./workspace-agent-opencode-launch-runtime.mjs";
import { captureOpenCodeFinalResult } from "./workspace-agent-opencode-launch-support.mjs";
import { buildStructuredDispatchProvenance, createLauncherObservedDispatchEnforcementForConfirmedIsolatedSpawn }
  from "./workspace-agent-dispatch-provenance.mjs";
import { attachDispatchProvenanceToSupervisedResult } from "./workspace-agent-inprocess-launch-policy.mjs";
import { assertGitMetadataProjectionComposed } from "./launch-isolation-findings-git-metadata.mjs";
import { createOpenCodeSchemaSession } from "./workspace-agent-opencode-schema-session.mjs";
import { captureOpenCodeSchemaFinalResult } from "./workspace-agent-opencode-final-result.mjs";

const refuse = (code, reason, detail) => buildFamilyModelRefusal({ code, reason, detail });

export async function launchOpenCode(context) {
  const { input, prepared, runtime, conduit, resources, options } = context;
  const nativeUsage = prepareNativeUsageLaunch({ family: "opencode", args: prepared.commandLine.args,
    usageTransport: prepared.commandLine.nativePrompt === undefined ? "stdout" : "opencode_api",
    workspaceDir: context.advisory?.repository ?? input.worktree_provisioning?.main_repo ?? input.workspace_dir,
    env: runtime.env, resumed: false,
    identity: { repo: context.advisory?.repository ?? input.worktree_provisioning?.main_repo ?? input.workspace_dir,
      run_id: input.run_id, attempt_id: input.run_id, subject: input.subject, role: input.role,
      route: "dispatched_role", mode: "headless" } });
  let child = null;
  let spawnFailure = null;
  const schemaSession = prepared.commandLine.nativePrompt === undefined ? null : createOpenCodeSchemaSession({
    directory: input.workspace_dir, password: runtime.env.OPENCODE_SERVER_PASSWORD,
    prompt: prepared.commandLine.nativePrompt, usageTap: nativeUsage.tap,
    runTimeoutMs: options.killTimeoutMs ?? STDIO_MCP_CONDUIT_RUN_TIMEOUT_MS });
  const supervised = await launchWorkspaceAgentFamilyLaunchLifecycle({
    ...prepared.commandLine, command: prepared.commandLine.command, args: prepared.commandLine.args,
    cwd: input.workspace_dir, env: runtime.env, role: input.role, subject: input.subject, kind: "opencode",
    options: { stdio: ["ignore", "pipe", "pipe"] },
    spawn: async () => {
      try {
        const plan = buildOpenCodeBwrapPlan(context);
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
    superviseChildLaunch, stdoutTap: nativeUsage.tap, afterSupervisionAttached: schemaSession?.start,
    parseFinalResult: facts => schemaSession === null ? captureOpenCodeFinalResult({ ...facts,
      role: input.role, subject: input.subject }) : captureOpenCodeSchemaFinalResult({ ...facts,
      sessionState: schemaSession.state, role: input.role, subject: input.subject }),
    killTimeoutMs: options.killTimeoutMs ?? STDIO_MCP_CONDUIT_RUN_TIMEOUT_MS,
    buildSpawnThrewRefusal: async detail => buildConduitSpawnFailureRefusal(refuse,
      spawnFailure ?? Object.assign(new Error(detail.message), detail), await cleanupConduitForRefusal(conduit)),
    buildNoChildRefusal: async () => {
      const cleanup = await cleanupConduitForRefusal(conduit);
      return refuse(BACKEND_REFUSAL_CODES.LAUNCH_FAILED_BEFORE_START, "opencode_spawn_no_child",
        { conduit_cleanup_failure: cleanup?.detail ?? null });
    },
    adaptSupervisedResult: result => {
      const nativeResult = schemaSession === null ? result : { ...result, probe: async () => {
        const probed = await result.probe();
        if (probed.final_result === null) return probed;
        const final = probed.final_result;
        return { ...probed,

          status: final.kind === "missing_result" ? "failed" : "succeeded",
          final_result: final.kind !== "missing_result" ? final : { ...final,
            missing_result: { ...final.missing_result, detail: { ...final.missing_result.detail,
              native_phase: schemaSession.state.phase, native_session_id: schemaSession.state.nativeSessionId,
              native_request_message_id: schemaSession.state.requestMessageId,
              native_error: schemaSession.state.error === null ? null : {
                code: schemaSession.state.error.code, message: schemaSession.state.error.message } } } } };
      } };
      return attachDispatchProvenanceToSupervisedResult(nativeResult, final => ({ ...final,
        provenance: buildStructuredDispatchProvenance({ runId: input.run_id, monitorHandle: input.monitor_handle,
          role: input.role, subject: input.subject, app: "opencode",
          transcriptSource: schemaSession === null ? "child_process_stdout" : "unavailable",
          enforcement: createLauncherObservedDispatchEnforcementForConfirmedIsolatedSpawn() }) }));
    }
  });
  const settled = resources.settle(supervised, child);
  if (settled.accepted !== true) return settled;
  const outcome = attachStdioMcpConduitLaunchOutcome(settled, conduit);

  await conduit.clientReady.then(() => undefined, () => settleStdioMcpConduitCleanup(conduit));
  return outcome;
}
