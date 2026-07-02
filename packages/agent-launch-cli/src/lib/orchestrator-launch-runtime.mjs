

import path from "node:path";
import { once } from "node:events";
import { readFile } from "node:fs/promises";

import {
  fileExists,
  writeJsonAtomic
} from "@agent-chassis/agent-launch-core/src/lib/filesystem.mjs";
import {
  deriveTerminalStatus,
  normalizeExitEnvelope,
  LAUNCHER_RUNTIME_STATES,
  isTerminalRuntimeState
} from "./workspace-agent-launch-adapter-contract.mjs";

export const ORCHESTRATOR_LAUNCH_RUNTIME_SCHEMA_VERSION =
  "orchestrator-launch-runtime.v1";

export const ORCHESTRATOR_SESSION_STATE_FILE_NAME = "session.json";

export const ORCHESTRATOR_FORWARDED_SIGNALS = Object.freeze(["SIGINT", "SIGTERM"]);

export const ORCHESTRATOR_INTERACTIVE_STDIO = "inherit";

export const ORCHESTRATOR_LEGACY_TERMINAL_STATE = "completed";
export const ORCHESTRATOR_RESUMABLE_RUNTIME_STATES = Object.freeze([
  ...LAUNCHER_RUNTIME_STATES,
  ORCHESTRATOR_LEGACY_TERMINAL_STATE
]);
const RESUMABLE_RUNTIME_STATE_SET = new Set(ORCHESTRATOR_RESUMABLE_RUNTIME_STATES);

function sessionStatePath(runtimeDir) {
  return path.join(runtimeDir, ORCHESTRATOR_SESSION_STATE_FILE_NAME);
}

export async function readOrchestratorSessionState(runtimeDir) {
  try {
    const filePath = sessionStatePath(runtimeDir);
    if (!(await fileExists(filePath))) return null;
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function hasResumableOrchestratorSession(runtimeDir) {
  const existing = await readOrchestratorSessionState(runtimeDir);
  if (!existing || typeof existing !== "object") return false;
  return RESUMABLE_RUNTIME_STATE_SET.has(existing.status);
}

export async function recordOrchestratorSessionState({
  runtimeDir,
  descriptor = {},
  status,
  extra = {},
  mergeExisting = false
} = {}) {
  const existing = mergeExisting ? await readOrchestratorSessionState(runtimeDir) : null;
  const record = {
    ...(existing && typeof existing === "object" ? existing : {}),
    ...descriptor,
    status,
    updated_at: new Date().toISOString(),
    ...extra
  };
  await writeJsonAtomic(sessionStatePath(runtimeDir), record);
  return record;
}

export async function superviseInteractiveOrchestratorLaunch({
  runtimeDir,
  descriptor = {},
  spawnChild,
  signals = ORCHESTRATOR_FORWARDED_SIGNALS
} = {}) {
  if (typeof spawnChild !== "function") {
    throw new TypeError(
      "superviseInteractiveOrchestratorLaunch requires a spawnChild thunk"
    );
  }

  let child = null;
  const signalForwarder = (signal) => {
    if (child?.pid) {
      try {
        child.kill(signal);
      } catch {

      }
    }
  };
  for (const signal of signals) {
    process.once(signal, signalForwarder);
  }

  try {
    await recordOrchestratorSessionState({
      runtimeDir,
      descriptor,
      status: "launching",
      extra: { pid: null }
    });

    child = spawnChild();

    let spawnError = null;
    child.once("error", (error) => {
      spawnError = error;
    });

    await recordOrchestratorSessionState({
      runtimeDir,
      descriptor,
      status: "running",
      extra: { pid: child.pid ?? null },
      mergeExisting: true
    });

    const [exitCode, signal] = await once(child, "exit");
    if (spawnError) {
      throw spawnError;
    }

    const status = deriveTerminalStatus({ code: exitCode, signal });
    const exit = normalizeExitEnvelope({ code: exitCode, signal });

    await recordOrchestratorSessionState({
      runtimeDir,
      descriptor,
      status,
      extra: {
        pid: child.pid ?? null,
        exit_code: exit.code,
        exit_signal: exit.signal
      },
      mergeExisting: true
    });

    return { status, exit, exitCode, signal };
  } catch (error) {
    await recordOrchestratorSessionState({
      runtimeDir,
      descriptor,
      status: "failed",
      extra: {
        launch_error: {
          message: error?.message ?? String(error),
          code: error?.code ?? null
        }
      },
      mergeExisting: true
    }).catch(() => {});
    throw error;
  } finally {
    for (const signal of signals) {
      process.removeListener(signal, signalForwarder);
    }
  }
}

export async function spawnOrchestratorAndWait({
  runtimeDir,
  descriptor = {},
  bwrapPlan,
  spawnLaunch,
  spawnOptions = {},
  signals = ORCHESTRATOR_FORWARDED_SIGNALS
} = {}) {
  if (typeof spawnLaunch !== "function") {
    throw new TypeError("spawnOrchestratorAndWait requires a spawnLaunch function");
  }
  if (!bwrapPlan || typeof bwrapPlan !== "object") {
    throw new TypeError("spawnOrchestratorAndWait requires a bwrapPlan object");
  }

  return superviseInteractiveOrchestratorLaunch({
    runtimeDir,
    descriptor,
    signals,
    spawnChild: () =>
      spawnLaunch(bwrapPlan, {
        ...spawnOptions,
        stdio: ORCHESTRATOR_INTERACTIVE_STDIO
      })
  });
}

export { isTerminalRuntimeState };
