

import { ORCHESTRATOR_FAMILY_REGISTRATIONS } from "./orchestrator-family-registrations.mjs";
import {
  deriveLauncherOwnedDispatchWorktreeRoot,
  ORCHESTRATOR_ISOLATION_MODES
} from "./orchestrator-launch-isolation.mjs";
import { HEADLESS_REQUIRES_BUBBLEWRAP_REASON } from "./orchestrator-launch-runtime.mjs";

export const ORCHESTRATOR_APP_UNREGISTERED_REASON = "orchestrator_app_unregistered";

export const ORCHESTRATOR_HEADLESS_NOT_ENABLED_REASON = "headless_not_yet_enabled";

export const ORCHESTRATOR_HEADLESS_DIRECT_MODE_UNSUPPORTED_REASON =
  HEADLESS_REQUIRES_BUBBLEWRAP_REASON;

export { deriveLauncherOwnedDispatchWorktreeRoot };

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
  registrations = ORCHESTRATOR_FAMILY_REGISTRATIONS
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

  const registration = Object.hasOwn(registrations, resolved.app)
    ? registrations[resolved.app] : null;
  if (!registration) {
    writeRaw(io.stderr,
      `agent-launch orchestrator: app=${resolved.app} is not registered for orchestrator/resume (${ORCHESTRATOR_APP_UNREGISTERED_REASON})\n`);
    process.exitCode = 2;
    return undefined;
  }
  const invoke = role === "orch-resume" ? registration.resume : registration.launch;
  return invoke({ role, resolved, initiative, focusArgs, dryRunJson, headless,
    logFile, env, cwd, io, dispatchWorktreeRoot });
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
