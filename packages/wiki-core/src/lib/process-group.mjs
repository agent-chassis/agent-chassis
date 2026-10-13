
export class ProcessGroupError extends Error {
  constructor(message, { code, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ProcessGroupError";
    this.code = code;
  }
}

function requireSupportedPlatform() {
  if (process.platform === "win32") {
    throw new ProcessGroupError("Process group ownership is unavailable on win32", {
      code: "process_group_unsupported"
    });
  }
}

export function signalProcessGroup(pid, signal) {
  requireSupportedPlatform();
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

export function processGroupExists(pid) {
  return signalProcessGroup(pid, 0);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForProcessGroupExit(pid, milliseconds) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return true;
    await delay(10);
  }
  return !processGroupExists(pid);
}

export async function terminateProcessGroup(pid, { termGraceMs, killGraceMs } = {}) {
  if (!processGroupExists(pid)) return;
  signalProcessGroup(pid, "SIGTERM");
  if (await waitForProcessGroupExit(pid, termGraceMs)) return;
  signalProcessGroup(pid, "SIGKILL");
  if (await waitForProcessGroupExit(pid, killGraceMs)) return;
  throw new ProcessGroupError("Process group remained present after SIGKILL", {
    code: "process_group_reap_timeout"
  });
}
