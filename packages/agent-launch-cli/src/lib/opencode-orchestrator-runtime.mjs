import { beginNativeUsageTask, prepareNativeUsageLaunch, writeNativeUsagePointer }
  from "@agent-chassis/agent-launch-core/src/lib/native-usage-records.mjs";

import { mkdir, appendFile } from "node:fs/promises";
import { prepareOpenCodeLaunch } from "./workspace-agent-opencode-launch-preflight.mjs";
import { buildOpenCodeRuntime } from "./workspace-agent-opencode-launch-runtime.mjs";
import { createManagedStdioMcpCompositionAuthority, assertManagedStdioMcpCompositionAuthority }
  from "./stdio-mcp-conduit-composition-compatibility.mjs";
import { mintTrustedStdioMcpConduitAuthority, resolveLauncherAgentSessionContract } from "./stdio-mcp-conduit-authority.mjs";
import { resolveLauncherConfiguredWorkspaceAlias, ensureWikiMcpResponseStateDir } from "./codex-role-mcp-env.mjs";
import { buildHeadlessOrchestratorBwrapPlan, buildInteractiveOrchestratorBwrapPlan }
  from "./orchestrator-launch-isolation.mjs";
import { deriveLauncherOwnedDispatchWorktreeRoot } from "./orchestrator-launch-isolation.mjs";
import { spawnIsolated } from "./launch-isolation.mjs";
import { superviseInteractiveOrchestratorLaunch, openHeadlessStdio, ORCHESTRATOR_INTERACTIVE_STDIO, readOrchestratorSessionState }
  from "./orchestrator-launch-runtime.mjs";
import { readOpenCodeSessionFacts } from "./opencode-orchestrator-session.mjs";
import { decodeOpenCodeEventStream } from "./workspace-agent-opencode-final-result.mjs";

export async function executeOpenCodeOrchestrator(plan, { env = process.env, io = {} } = {}) {
  const prepared = await prepareOpenCodeLaunch({ input: { role: plan.role, workspace_dir: plan.repo,
    model: plan.settings.model, model_selection: plan.modelSelection },
    resultMode: "free_prose", prompt: plan.prompt, env, options: { registeredTier: plan.hostProfile.registeredTier, publishControlledAcceptanceOptOut: plan.hostProfile.publishControlledAcceptanceOptOut,
      headless: plan.headless, nativeSessionId: plan.previous?.native_session_id ?? null } });

  await mkdir(plan.runtimeDir, { recursive: true, mode: 0o700 });
  prepared.runtimeStateDir = plan.runtimeDir;
  const begun = beginNativeUsageTask({ workspaceDir: plan.repo, env });
  const nativeUsage = prepareNativeUsageLaunch({ family: "opencode", args: prepared.commandLine.args,
    workspaceDir: plan.repo, env, begun, resumed: plan.previous !== null,
    identity: { repo: plan.repo, subject: plan.subject, role: plan.role, route: "orchestrator",
      mode: plan.headless ? "headless" : "interactive" } });
  if (nativeUsage.records_dir !== null) await writeNativeUsagePointer(plan.runtimeDir, nativeUsage.records_dir);
  const { createConduit } = assertManagedStdioMcpCompositionAuthority(createManagedStdioMcpCompositionAuthority());
  const authority = mintTrustedStdioMcpConduitAuthority({ family: "opencode", role: "orchestrator",
    assignedUnit: plan.subject, workspaceDir: plan.repo });
  const responseStateDir = ensureWikiMcpResponseStateDir({ runtimeDir: plan.runtimeDir, workspaceDir: plan.repo });
  const conduit = await createConduit({ family: "opencode", role: "orchestrator", assignedUnit: plan.subject,
    workspaceDir: plan.repo, dispatchWorktreeRoot: plan.dispatchWorktreeRoot,
    workspaceAlias: resolveLauncherConfiguredWorkspaceAlias({ env, repo: plan.repo, mcpServerName: "wiki" }),
    responseStateDir,
    authority, sessionContract: resolveLauncherAgentSessionContract(authority), hostSessionProfile: plan.hostProfile });
  try {
    const runtime = await buildOpenCodeRuntime({ prepared, conduit, env,
      retainedStateRoot: plan.previous?.native_state_root ?? null, responseStateDir,
      managedWorktreeRoot: deriveLauncherOwnedDispatchWorktreeRoot(plan.repo) });
    const build = plan.headless ? buildHeadlessOrchestratorBwrapPlan : buildInteractiveOrchestratorBwrapPlan;
    const isolated = build({ repo: plan.repo, command: prepared.commandLine.command, args: prepared.commandLine.args,
      env: runtime.env, envPolicy: runtime.envPolicy, runtimeDir: runtime.stateRoot,
      additionalReadOnlyRoots: [runtime.configRoot, responseStateDir], additionalMaskTmpfsDirs: runtime.masks,
      homeReadOnlyFiles: prepared.credentialsFile === null ? [] : [prepared.credentialsFile],
      familyRuntimePolicyProfile: prepared.profile, resolveExecutable: () => prepared.executable,
      familyRuntimeReadOnlyRoots: prepared.runtimeReadOnlyRoots,
      stdioMcpConduit: conduit, dispatchWorktreeRoot: plan.dispatchWorktreeRoot,
      launchRole: plan.role, registeredTier: plan.hostProfile.registeredTier, publishControlledAcceptanceOptOut: plan.hostProfile.publishControlledAcceptanceOptOut });
    const descriptor = { schema_version: "opencode-orchestrator-session.v1", family: "opencode",
      repo: plan.repo, subject: plan.subject, settings: plan.settings,
      native_state_root: runtime.stateRoot, native_session_id: plan.previous?.native_session_id ?? null,
      conduit_run_id: conduit.runId, native_config_path: runtime.env.OPENCODE_CONFIG,
      guide_path: plan.guideDelivery.guidePath, registered_tier: plan.hostProfile.registeredTier,
      headless: plan.headless, args: [...prepared.commandLine.args] };
    const outcome = await superviseInteractiveOrchestratorLaunch({ runtimeDir: plan.runtimeDir, descriptor,
      stdioMcpConduit: conduit, stderr: io.stderr,
      nativeUsage: nativeUsage.tap === null ? null : { tap: nativeUsage.tap, logPath: plan.headlessLogTarget.logPath },
      nativeCompletion: { captureStdout: plan.headless, complete: async ({ stdout }) => {
        if (plan.headless && nativeUsage.tap === null) await appendFile(plan.headlessLogTarget.logPath, stdout);
        const facts = readOpenCodeSessionFacts({ stateRoot: runtime.stateRoot, repo: plan.repo,
          nativeSessionId: plan.previous?.native_session_id ?? null,
          afterMessageId: plan.previous?.native_last_message_id ?? null });
        const decoded = plan.headless ? decodeOpenCodeEventStream(stdout) : facts.completion;
        const identityMatches = decoded.nativeSessionId === facts.nativeSessionId;
        const messageMatches = decoded.terminalMessageId === facts.completion.terminalMessageId;
        return { ok: decoded.ok && facts.completion.ok && identityMatches && messageMatches,
          reason: !decoded.ok ? decoded.reason : !facts.completion.ok ? facts.completion.reason
            : !identityMatches ? "opencode_session_id_conflict" : !messageMatches ? "opencode_message_id_conflict" : undefined,
          extra: { native_session_id: facts.nativeSessionId, native_last_message_id: facts.lastMessageId } };
      } },
      spawnChild: () => {
        if (!plan.headless) return spawnIsolated(isolated, { stdio: ORCHESTRATOR_INTERACTIVE_STDIO });
        const opened = openHeadlessStdio(plan.headlessLogTarget);
        try { return spawnIsolated(isolated, { stdio: ["ignore", "pipe", opened.stdio[2]] }); }
        finally { opened.close(); }
      } });
    if (outcome.status !== "succeeded") process.exitCode = 1;
    const retained = await readOrchestratorSessionState(plan.runtimeDir);
    (io.stdout ?? process.stdout).write(`${JSON.stringify({ family: "opencode", model: plan.settings.model,
      effort: plan.settings.effort, native_session_id: retained?.native_session_id ?? null,
      native_completion_reason: retained?.native_completion_reason ?? null, ...outcome, runtime_dir: plan.runtimeDir })}\n`);
    return outcome;
  } finally { await conduit.cleanup(); }
}
