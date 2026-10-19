import { runCodexRole } from "../commands/codex-role.mjs";
import { runClaudeOrchestrator, runClaudeOrchestratorResume } from "./claude-orchestrator-plan.mjs";
import { runAgyOrchestrator, runAgyOrchestratorResume } from "./agy-orchestrator-plan.mjs";
import { runOpenCodeOrchestrator, runOpenCodeOrchestratorResume } from "./opencode-orchestrator-plan.mjs";

const claudeContext = ({ focusArgs, resolved, ...context }) =>
  ({ ...context, promptArgs: focusArgs, resolvedProfile: resolved });
export function createOrchestratorFamilyRegistrations({
  claudeLaunch = runClaudeOrchestrator, claudeResume = runClaudeOrchestratorResume,
  codexRun = runCodexRole, agyLaunch = runAgyOrchestrator, agyResume = runAgyOrchestratorResume,
  opencodeLaunch = runOpenCodeOrchestrator, opencodeResume = runOpenCodeOrchestratorResume
} = {}) {
  const codexInvoke = ({ role, initiative, dryRunJson, focusArgs, io, resolved,
    headless, logFile, dispatchWorktreeRoot }) => {
    const argv = [role];
    if (typeof initiative === "string") argv.push(initiative);
    if (dryRunJson) argv.push("--dry-run-json");
    argv.push(...focusArgs);
    return codexRun(argv, io, { resolvedProfile: resolved, headless, logFile, dispatchWorktreeRoot });
  };
  return Object.freeze({
    claude: Object.freeze({
      launch: (context) => claudeLaunch(claudeContext(context)),
      resume: (context) => claudeResume(claudeContext(context))
    }),
    codex: Object.freeze({ launch: codexInvoke, resume: codexInvoke }),
    agy: Object.freeze({ launch: agyLaunch, resume: agyResume }),
    opencode: Object.freeze({ launch: opencodeLaunch, resume: opencodeResume })
  });
}

export const ORCHESTRATOR_FAMILY_REGISTRATIONS = createOrchestratorFamilyRegistrations();
