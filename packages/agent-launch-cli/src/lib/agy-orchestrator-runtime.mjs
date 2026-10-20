import { beginNativeUsageTask, prepareNativeUsageLaunch, writeNativeUsagePointer }
  from "@agent-chassis/agent-launch-core/src/lib/native-usage-records.mjs";

import { mkdir } from "node:fs/promises";
import { prepareAgyLaunch } from "./workspace-agent-agy-launch-preflight.mjs";
import { buildAgyRuntime } from "./workspace-agent-agy-launch-runtime.mjs";
import { createManagedStdioMcpCompositionAuthority, assertManagedStdioMcpCompositionAuthority }
  from "./stdio-mcp-conduit-composition-compatibility.mjs";
import { mintTrustedStdioMcpConduitAuthority, resolveLauncherAgentSessionContract } from "./stdio-mcp-conduit-authority.mjs";
import { resolveLauncherConfiguredWorkspaceAlias, ensureWikiMcpResponseStateDir } from "./codex-role-mcp-env.mjs";
import { buildHeadlessOrchestratorBwrapPlan, buildInteractiveOrchestratorBwrapPlan }
  from "./orchestrator-launch-isolation.mjs";
import { spawnIsolated } from "./launch-isolation.mjs";
import { superviseInteractiveOrchestratorLaunch, openHeadlessStdio, ORCHESTRATOR_INTERACTIVE_STDIO, readOrchestratorSessionState }
  from "./orchestrator-launch-runtime.mjs";
import { readAgySessionFacts } from "./agy-orchestrator-session.mjs";
import { createAgyNativeExport } from "./agy-native-export.mjs";

export async function executeAgyOrchestrator(plan, { env = process.env, io = {} } = {}) {
  const prepared = await prepareAgyLaunch({ configurationWorkspaceDir: plan.repo,
    input: { role: plan.role, workspace_dir: plan.repo,
    model: plan.settings.model, model_selection: { effort: plan.settings.effort, high_priority_role_guide: true } },
    resultMode: "free_prose", prompt: plan.prompt, env, options: { registeredTier: plan.hostProfile.registeredTier, publishControlledAcceptanceOptOut: plan.hostProfile.publishControlledAcceptanceOptOut,
      headless: plan.headless, nativeSessionId: plan.previous?.native_session_id ?? null } });

  await mkdir(plan.runtimeDir, { recursive: true, mode: 0o700 });
  prepared.runtimeStateDir = plan.runtimeDir;
  const begun = beginNativeUsageTask({ workspaceDir: plan.repo, env });
  const nativeUsage = prepareNativeUsageLaunch({ family: "agy", args: prepared.commandLine.args,
    workspaceDir: plan.repo, env, begun, resumed: plan.previous !== null,
    identity: { repo: plan.repo, subject: plan.subject, role: plan.role, route: "orchestrator",
      mode: plan.headless ? "headless" : "interactive" } });
  if (nativeUsage.records_dir !== null) await writeNativeUsagePointer(plan.runtimeDir, nativeUsage.records_dir);
  const { createConduit } = assertManagedStdioMcpCompositionAuthority(createManagedStdioMcpCompositionAuthority());
  const authority = mintTrustedStdioMcpConduitAuthority({ family: "agy", role: "orchestrator",
    assignedUnit: plan.subject, workspaceDir: plan.repo });
  const conduit = await createConduit({ family: "agy", role: "orchestrator", assignedUnit: plan.subject,
    workspaceDir: plan.repo, dispatchWorktreeRoot: plan.dispatchWorktreeRoot,
    workspaceAlias: resolveLauncherConfiguredWorkspaceAlias({ env, repo: plan.repo, mcpServerName: "wiki" }),
    responseStateDir: ensureWikiMcpResponseStateDir({ runtimeDir: plan.runtimeDir, workspaceDir: plan.repo }),
    authority, sessionContract: resolveLauncherAgentSessionContract(authority), hostSessionProfile: plan.hostProfile });
  let nativeExport = null;
  try {
    const runtime = await buildAgyRuntime({ prepared, conduit, env,
      retainedStateRoot: plan.previous?.native_state_root ?? null });
    const build = plan.headless ? buildHeadlessOrchestratorBwrapPlan : buildInteractiveOrchestratorBwrapPlan;
    const isolated = build({ repo: plan.repo, command: prepared.commandLine.command, args: prepared.commandLine.args,
      env: runtime.env, envPolicy: runtime.envPolicy, runtimeDir: runtime.stateRoot,
      additionalReadOnlyRoots: [runtime.configRoot], additionalMaskTmpfsDirs: runtime.masks,
      homeReadOnlyFiles: prepared.credentialsFile === null ? [] : [prepared.credentialsFile],
      familyRuntimePolicyProfile: prepared.profile, resolveExecutable: () => prepared.executable,
      stdioMcpConduit: conduit, dispatchWorktreeRoot: plan.dispatchWorktreeRoot,
      launchRole: plan.role, registeredTier: plan.hostProfile.registeredTier, publishControlledAcceptanceOptOut: plan.hostProfile.publishControlledAcceptanceOptOut });
    if (plan.headless) nativeExport = createAgyNativeExport(plan.runtimeDir);
    const descriptor = { schema_version: "agy-orchestrator-session.v1", family: "agy",
      repo: plan.repo, subject: plan.subject, settings: plan.settings,
      native_state_root: runtime.stateRoot, native_session_id: plan.previous?.native_session_id ?? null,
      conduit_run_id: conduit.runId, native_config_path: runtime.configRoot,
      guide_path: plan.guideDelivery.guidePath, registered_tier: plan.hostProfile.registeredTier,
      native_export_path: nativeExport?.file ?? null,
      headless: plan.headless, args: [...prepared.commandLine.args] };
    const outcome = await superviseInteractiveOrchestratorLaunch({ runtimeDir: plan.runtimeDir, descriptor,
      stdioMcpConduit: conduit, stderr: io.stderr,
      nativeUsage: nativeUsage.tap === null ? null : { tap: nativeUsage.tap, logPath: plan.headlessLogTarget.logPath },
      nativeCompletion: { captureStdout: false, captureStderr: plan.headless,
        stderrLogPath: plan.headless ? plan.headlessLogTarget.logPath : null, complete: async ({ stderr }) => {
        return completeAgyOrchestratorInvocation({ stateRoot: runtime.stateRoot, repo: plan.repo,
          previous: plan.previous, nativeExport,
          stderr, logPath: nativeUsage.tap === null && plan.headless ? plan.headlessLogTarget.logPath : null });
      } },
      spawnChild: () => {
        if (!plan.headless) return spawnIsolated(isolated, { stdio: ORCHESTRATOR_INTERACTIVE_STDIO });
        const opened = openHeadlessStdio(plan.headlessLogTarget);
        try {
          const child = spawnIsolated(isolated, { stdio: ["ignore", "pipe", "pipe"] });
          nativeExport.attach(child.stdout);
          return child;
        }
        finally { opened.close(); }
      } });
    if (outcome.status !== "succeeded") process.exitCode = 1;
    const retained = await readOrchestratorSessionState(plan.runtimeDir);
    (io.stdout ?? process.stdout).write(`${JSON.stringify({ family: "agy", model: plan.settings.model,
      effort: plan.settings.effort, native_session_id: retained?.native_session_id ?? null,
      native_completion_reason: retained?.native_completion_reason ?? null, ...outcome, runtime_dir: plan.runtimeDir })}\n`);
    return outcome;
  } finally { nativeExport?.close(); await conduit.cleanup(); }
}

export async function completeAgyOrchestratorInvocation({ stateRoot, repo, previous = null,
  nativeExport = null, stderr = "", logPath = null }) {
  let facts, stateError;
  try {
    facts = readAgySessionFacts({ stateRoot, repo, nativeSessionId: previous?.native_session_id ?? null,
      afterStepIndex: previous?.native_last_step_index ?? -1 });
  } catch (error) { stateError = error; }
  const headlessResult = nativeExport === null ? null : await nativeExport.complete({ stderr, logPath, sessionFacts: facts });
  if (stateError) {
    if (headlessResult?.ok !== false) throw stateError;
    return { ok: false, reason: headlessResult.reason, extra: { ...headlessResult.extra,
      native_state_failure: { message: stateError.message, code: stateError.code ?? null } } };
  }
  const decoded = headlessResult ?? facts.completion;
  const stateCompletion = headlessResult?.stateCompletion ?? facts.completion;
  const identityMatches = nativeExport === null || decoded.nativeSessionId === facts.nativeSessionId;
  return { ok: decoded.ok && stateCompletion.ok && identityMatches,
    reason: !decoded.ok ? decoded.reason : !stateCompletion.ok ? stateCompletion.reason
      : !identityMatches ? "agy_session_id_conflict" : undefined,
    extra: { ...decoded.extra, native_session_id: facts.nativeSessionId, native_last_step_index: facts.lastStepIndex } };
}
