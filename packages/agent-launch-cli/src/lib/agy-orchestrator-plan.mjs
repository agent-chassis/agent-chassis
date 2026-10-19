import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import { resolveLauncherRuntimeStateDir } from "@agent-chassis/agent-launch-core/src/lib/config.mjs";
import { resolveConfiguredAgentExecutable } from "@agent-chassis/agent-launch-core/src/lib/registry.mjs";
import { resolveRoleGuideInstructions, withRoleGuideInstructionsPrompt } from "./role-guide-instructions.mjs";
import { resolveLauncherHostSessionProfile } from "./launcher-host-session-profile.mjs";
import { renderLauncherFamilyOrchestratorPrompt } from "./workspace-agent-role-contract.mjs";
import { buildAgyCommandLine } from "./workspace-agent-agy-launch-support.mjs";
import { readOrchestratorSessionState, hasResumableOrchestratorSession } from "./orchestrator-launch-runtime.mjs";
import { resolveHeadlessLogTarget } from "./orchestrator-launch-runtime.mjs";
import { sanitizeOrchestratorPathSegment, buildOrchestratorThreadName } from "./orchestrator-launch-settings.mjs";
import { validateAgyResumeState } from "./agy-orchestrator-session.mjs";
import { executeAgyOrchestrator } from "./agy-orchestrator-runtime.mjs";
import { composeOrchestratorRefusalReason, makeOrchestratorRefusal,
  ORCHESTRATOR_REFUSAL_REASON_KINDS } from "./orchestrator-refusal-taxonomy.mjs";

export async function buildAgyOrchestratorPlan(context) {
  const { initiative, resolved, headless = false, env = process.env, cwd = process.cwd(),
    focusArgs = [], role = "orch", logFile = null } = context;
  if (!/^IN-[0-9]+$/.test(initiative)) throw new Error("Agy requires an initiative ID");
  const repo = await realpath(cwd);
  if (!(await stat(path.join(repo, "wiki", "initiatives", `${initiative}.md`))).isFile()) throw new Error("Missing initiative");
  const root = resolveLauncherRuntimeStateDir({ workspaceDir: repo, env });
  if (!root.ok) throw Object.assign(new Error(root.reason), { code: root.code });
  const runtimeDir = path.join(root.dir, "agy-orchestrator", sanitizeOrchestratorPathSegment(initiative));
  if (role === "orch-resume" && !await hasResumableOrchestratorSession(runtimeDir)) {
    throw new Error("agy_native_session_record_missing_or_mismatched");
  }
  const previous = role === "orch-resume" ? validateAgyResumeState(await readOrchestratorSessionState(runtimeDir),
    { repo, initiative, runtimeDir }) : null;
  const hostProfile = resolveLauncherHostSessionProfile({ workspaceDir: repo, role: "orchestrator" });
  const guideDelivery = resolveRoleGuideInstructions({ role, workspaceDir: repo, selection: resolved,
    registeredTier: hostProfile.registeredTier, publishControlledAcceptanceOptOut: hostProfile.publishControlledAcceptanceOptOut });
  if (guideDelivery?.highPriority !== true) throw new Error("agy_native_guide_delivery_unavailable: select high_priority_role_guide");
  const threadName = buildOrchestratorThreadName({ subject: initiative, repoName: path.basename(repo) });
  const prompt = withRoleGuideInstructionsPrompt(renderLauncherFamilyOrchestratorPrompt({
    appName: "Agy", initiative, threadName, repo, workspaceDir: repo,
    focus: focusArgs.join(" "), headless, registeredTier: hostProfile.registeredTier, publishControlledAcceptanceOptOut: hostProfile.publishControlledAcceptanceOptOut }), guideDelivery);
  const configured = await resolveConfiguredAgentExecutable({ agentName: "agy", workspaceDir: repo });
  const commandLine = buildAgyCommandLine({ executable: configured.executable, leadingArgs: configured.leadingArgs,
    model: resolved.model, effort: resolved.effort, prompt, headless, resultMode: "free_prose",
    nativeSessionId: previous?.native_session_id ?? null });
  return { schema_version: "agy-orchestrator-plan.v1", planner_kind: "agy_orchestrator",
    family: "agy", mode: previous === null ? "start" : "resume", role, subject: initiative,
    repo, runtimeDir, threadName, settings: { model: resolved.model, effort: resolved.effort },
    command: commandLine.command, args: commandLine.args, commandLine, prompt, guideDelivery, hostProfile,
    headless, previous, headlessLogTarget: headless ? resolveHeadlessLogTarget({ runtimeDir, logFileOverride: logFile }) : null,
    dispatchWorktreeRoot: context.dispatchWorktreeRoot };
}

async function run(context, role) {
  try {
    const plan = await buildAgyOrchestratorPlan({ ...context, role });
    if (context.dryRunJson) {
      const projection = { ...plan, hostProfile: undefined, guideDelivery: { guidePath: plan.guideDelivery.guidePath,
        highPriority: true }, previous: undefined, commandLine: undefined,
        native_session_id: plan.previous?.native_session_id ?? null, wiki_mcp_transport: "launcher_named_fifo_stdio",
        isolation: { mode: "bubblewrap" }, native_config: "private native home and MCP config; workspace discovery masked" };
      (context.io?.stdout ?? process.stdout).write(`${JSON.stringify(projection, null, 2)}\n`);
      return projection;
    }
    return await executeAgyOrchestrator(plan, context);
  } catch (error) {
    const refusal = makeOrchestratorRefusal({ command: "agy",
      code: composeOrchestratorRefusalReason("agy", ORCHESTRATOR_REFUSAL_REASON_KINDS.NATIVE_CAPABILITY_UNAVAILABLE),
      message: error.message, detail: { cause: error.code ?? error.message }, subject: context.initiative, repo: context.cwd });
    (context.io?.stderr ?? process.stderr).write(`${JSON.stringify(refusal)}\n`);
    process.exitCode = 2;
    return refusal;
  }
}
export const runAgyOrchestrator = context => run(context, "orch");
export const runAgyOrchestratorResume = context => run(context, "orch-resume");
