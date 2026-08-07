

const PROCESS_LOCAL_CONDUIT_CLEANUPS = new Set();
const DRAINED_LAUNCHER_SIGNALS = Object.freeze(["SIGINT", "SIGTERM", "SIGHUP"]);
let processLocalSignalHandlers = null;
let processLocalDrain = null;

export async function drainProcessLocalStdioMcpConduits() {

  const pending = [...PROCESS_LOCAL_CONDUIT_CLEANUPS];
  const settled = await Promise.allSettled(pending.map((settle) => settle()));
  return settled.filter((entry) => entry.status === "fulfilled" && entry.value)
    .map((entry) => entry.value);
}

function disarmProcessLocalStdioMcpConduitSignals() {
  if (processLocalSignalHandlers === null) return;
  for (const [signal, handler] of processLocalSignalHandlers) {
    process.removeListener(signal, handler);
  }
  processLocalSignalHandlers = null;
}

function armProcessLocalStdioMcpConduitSignals() {
  if (processLocalSignalHandlers !== null) return;
  processLocalSignalHandlers = new Map();
  for (const signal of DRAINED_LAUNCHER_SIGNALS) {
    const handler = () => {

      if (processLocalDrain === null) {
        processLocalDrain = drainProcessLocalStdioMcpConduits()
          .catch(() => [])
          .then(() => {

            disarmProcessLocalStdioMcpConduitSignals();
            process.kill(process.pid, signal);
          });
      }
      void processLocalDrain;
    };
    process.on(signal, handler);
    processLocalSignalHandlers.set(signal, handler);
  }
}

export function registerProcessLocalStdioMcpConduit(settle) {
  if (typeof settle !== "function") return () => {};
  PROCESS_LOCAL_CONDUIT_CLEANUPS.add(settle);
  armProcessLocalStdioMcpConduitSignals();
  return () => {
    PROCESS_LOCAL_CONDUIT_CLEANUPS.delete(settle);
    if (PROCESS_LOCAL_CONDUIT_CLEANUPS.size === 0) {
      disarmProcessLocalStdioMcpConduitSignals();
    }
  };
}

export function countProcessLocalStdioMcpConduits() {
  return PROCESS_LOCAL_CONDUIT_CLEANUPS.size;
}
