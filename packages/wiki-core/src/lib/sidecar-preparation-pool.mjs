import {
  sidecarPreparationCancelledError,
  throwIfSidecarPreparationCancelled
} from "./sidecar-store-lifecycle.mjs";

export const SIDECAR_PREPARATION_MAX_ACTIVE = 8;
const activePreparations = new Map();
const capacityWaiters = new Set();

export const sidecarPreparationKey = (repoRoot, cacheDir, mode, retry, owner) =>
  JSON.stringify([repoRoot, cacheDir, mode, retry === true, owner]);

function wakeCapacityWaiters() {
  for (const wake of [...capacityWaiters]) wake();
}

async function waitForCapacity(signal) {
  while (activePreparations.size >= SIDECAR_PREPARATION_MAX_ACTIVE) {
    throwIfSidecarPreparationCancelled(signal);
    await new Promise((resolve, reject) => {
      const onAbort = () => {
        capacityWaiters.delete(wake);
        reject(sidecarPreparationCancelledError(signal));
      };
      const wake = () => {
        capacityWaiters.delete(wake);
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      capacityWaiters.add(wake);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

function startPreparation(key, work) {
  const controller = new AbortController();
  const entry = { waiters: 0, settled: false, controller, promise: null };
  entry.promise = (async () => work(controller.signal))().finally(() => {
    entry.settled = true;
    if (activePreparations.get(key) === entry) activePreparations.delete(key);
    wakeCapacityWaiters();
  });
  entry.promise.catch(() => {});
  activePreparations.set(key, entry);
  return entry;
}

function joinPreparation(entry, signal) {
  entry.waiters += 1;
  return new Promise((resolve, reject) => {
    let attached = true;
    const detach = () => {
      if (!attached) return false;
      attached = false;
      entry.waiters -= 1;
      signal?.removeEventListener("abort", onAbort);
      return true;
    };
    function onAbort() {
      if (!detach()) return;
      if (entry.waiters === 0 && !entry.settled) entry.controller.abort(signal.reason);
      reject(sidecarPreparationCancelledError(signal));
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    entry.promise.then((value) => {
      if (detach()) resolve(value);
    }, (error) => {
      if (detach()) reject(error);
    });
  });
}

export async function withSidecarPreparation(key, work, signal) {
  throwIfSidecarPreparationCancelled(signal);
  const usable = candidate => candidate && !candidate.controller.signal.aborted ? candidate : undefined;
  let entry = usable(activePreparations.get(key));
  let joined = entry !== undefined;
  while (!entry) {
    await waitForCapacity(signal);
    throwIfSidecarPreparationCancelled(signal);
    entry = usable(activePreparations.get(key));
    joined = entry !== undefined;
    if (!entry && activePreparations.size >= SIDECAR_PREPARATION_MAX_ACTIVE) continue;
    entry ??= startPreparation(key, work);
  }
  return { result: await joinPreparation(entry, signal), joined };
}
