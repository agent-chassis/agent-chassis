

import path from "node:path";
import { realpathSync } from "node:fs";

import { runCodexRole } from "../commands/codex-role.mjs";
import {
  runClaudeOrchestrator,
  runClaudeOrchestratorResume
} from "./claude-orchestrator-plan.mjs";
import { ORCHESTRATOR_ISOLATION_MODES } from "./orchestrator-launch-isolation.mjs";
import { HEADLESS_REQUIRES_BUBBLEWRAP_REASON } from "./orchestrator-launch-runtime.mjs";

export const ORCHESTRATOR_AGY_UNSUPPORTED_REASON = "agy_orchestrator_unsupported";

export const ORCHESTRATOR_HEADLESS_NOT_ENABLED_REASON = "headless_not_yet_enabled";

export const ORCHESTRATOR_HEADLESS_DIRECT_MODE_UNSUPPORTED_REASON =
  HEADLESS_REQUIRES_BUBBLEWRAP_REASON;

export const DEFAULT_ORCHESTRATOR_FAMILY_RUNNERS = Object.freeze({
  runClaudeOrchestrator,
  runClaudeOrchestratorResume,
  runCodexRole
});

export function deriveLauncherOwnedDispatchWorktreeRoot(cwd = process.cwd()) {
  const repo = realpathSync(path.resolve(cwd));
  return path.join(path.dirname(repo), ".agent-worktrees", path.basename(repo));
}

export async function routeOrchestratorLaunch({
  role,
  resolved,
  initiative = null,
  focusArgs = [],
  dryRunJson = false,
  headless = false,
  logFile = null,
  env = process.env,
  cwd = process.cwd(),
  io = {},
  runners = DEFAULT_ORCHESTRATOR_FAMILY_RUNNERS
} = {}) {

  const dispatchWorktreeRoot = deriveLauncherOwnedDispatchWorktreeRoot(cwd);

  if (headless && resolvedOrchestratorIsolationMode(resolved) === ORCHESTRATOR_ISOLATION_MODES.DIRECT) {
    writeRaw(
      io.stderr,
      `agent-launch orchestrator: --headless is not supported with DEC-0060 direct mode for app=${resolved.app} (${ORCHESTRATOR_HEADLESS_DIRECT_MODE_UNSUPPORTED_REASON})\n`
    );
    process.exitCode = 2;
    return undefined;
  }

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
      dryRunJson,
      headless,
      logFile,
      dispatchWorktreeRoot
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
  if (headless) {
    codexArgv.push("--headless");
    if (typeof logFile === "string") {
      codexArgv.push("--log-file", logFile);
    }
  }
  for (const focusArg of focusArgs) {
    codexArgv.push(focusArg);
  }
  return runners.runCodexRole(codexArgv, io, {
    resolvedProfile: resolved,
    headless,
    logFile,
    dispatchWorktreeRoot
  });
}

function writeRaw(stream, value) {
  if (stream?.write) {
    stream.write(value);
  } else {
    process.stdout.write(value);
  }
}

function resolvedOrchestratorIsolationMode(resolved) {
  if (!resolved || typeof resolved !== "object") {
    return null;
  }
  const candidates = [
    resolved.isolationMode,
    resolved.isolation_mode,
    resolved.operatorIsolation?.mode,
    resolved.operator_isolation?.mode,
    resolved.isolation?.mode
  ];
  for (const candidate of candidates) {
    if (candidate === ORCHESTRATOR_ISOLATION_MODES.DIRECT) {
      return ORCHESTRATOR_ISOLATION_MODES.DIRECT;
    }
    if (candidate === ORCHESTRATOR_ISOLATION_MODES.BUBBLEWRAP) {
      return ORCHESTRATOR_ISOLATION_MODES.BUBBLEWRAP;
    }
  }
  if (resolved.direct_mode === true || resolved.operator_direct_mode === true) {
    return ORCHESTRATOR_ISOLATION_MODES.DIRECT;
  }
  return null;
}
