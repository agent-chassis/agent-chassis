

import { runCodexRole } from "../commands/codex-role.mjs";
import {
  runClaudeOrchestrator,
  runClaudeOrchestratorResume
} from "./claude-orchestrator-plan.mjs";

export const ORCHESTRATOR_AGY_UNSUPPORTED_REASON = "agy_orchestrator_unsupported";

export const DEFAULT_ORCHESTRATOR_FAMILY_RUNNERS = Object.freeze({
  runClaudeOrchestrator,
  runClaudeOrchestratorResume,
  runCodexRole
});

export async function routeOrchestratorLaunch({
  role,
  resolved,
  initiative = null,
  focusArgs = [],
  dryRunJson = false,
  env = process.env,
  cwd = process.cwd(),
  io = {},
  runners = DEFAULT_ORCHESTRATOR_FAMILY_RUNNERS
} = {}) {
  if (resolved.app === "claude") {
    const claudeRunner = role === "orch-resume"
      ? runners.runClaudeOrchestratorResume
      : runners.runClaudeOrchestrator;
    return claudeRunner({
      role,
      initiative,
      promptArgs: focusArgs,
      env,
      cwd,
      resolvedProfile: resolved,
      io,
      dryRunJson
    });
  }

  if (resolved.app !== "codex") {
    writeRaw(
      io.stderr,
      `agent-launch orchestrator: app=${resolved.app} is not supported for orchestrator/resume (${ORCHESTRATOR_AGY_UNSUPPORTED_REASON})\n`
    );
    process.exitCode = 2;
    return undefined;
  }

  const codexArgv = [role];
  if (typeof initiative === "string") {
    codexArgv.push(initiative);
  }
  if (dryRunJson) {
    codexArgv.push("--dry-run-json");
  }
  for (const focusArg of focusArgs) {
    codexArgv.push(focusArg);
  }
  return runners.runCodexRole(codexArgv, io, { resolvedProfile: resolved });
}

function writeRaw(stream, value) {
  if (stream?.write) {
    stream.write(value);
  } else {
    process.stdout.write(value);
  }
}
