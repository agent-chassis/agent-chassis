import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { observeSidecarRefreshWorker } from "./sidecar-refresh-process.mjs";
import { projectFailureDiagnosis } from "./diagnostic-projection.mjs";

export { SidecarRefreshError } from "./sidecar-refresh-process.mjs";

export const SIDECAR_REFRESH_MAX_RUNNING = 2;
export const SIDECAR_REFRESH_MAX_QUEUED = 8;
export const SIDECAR_REFRESH_RETRY_BASE_MS = 30_000;
export const SIDECAR_REFRESH_RETRY_MAX_MS = 900_000;

export const SIDECAR_REFRESH_REVALIDATE_MS = 300_000;
export const SIDECAR_REFRESH_STATES = Object.freeze(["idle", "queued", "running", "completed", "failed",
  "rejected"]);

const WORKER_PATH = fileURLToPath(new URL("./sidecar-refresh-worker.mjs", import.meta.url));

export function launchSidecarRefreshWorker({ repoRoot, cacheDir }) {
  const child = fork(WORKER_PATH, [], { execArgv: [], env: process.env,
    stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const worker = observeSidecarRefreshWorker(child);
  worker.send({ dir: repoRoot, cacheDir });
  return worker;
}

function samePublication(left, right) {
  return left?.store_incarnation === right?.store_incarnation && left?.sequence === right?.sequence &&
    left?.repository_commit === right?.repository_commit;
}

export function createSidecarRefreshCoordinator({
  launchWorker = launchSidecarRefreshWorker,
  now = Date.now,
  maxRunning = SIDECAR_REFRESH_MAX_RUNNING,
  maxQueued = SIDECAR_REFRESH_MAX_QUEUED,
  retryBaseMs = SIDECAR_REFRESH_RETRY_BASE_MS,
  retryMaxMs = SIDECAR_REFRESH_RETRY_MAX_MS,
  revalidateAfterMs = SIDECAR_REFRESH_REVALIDATE_MS
} = {}) {
  const entries = new Map();
  const queue = [];
  let running = 0;
  let closed = false;

  const keyOf = (repoRoot, cacheDir) => JSON.stringify([repoRoot, cacheDir]);
  const stamp = (value) => (value === null ? null : new Date(value).toISOString());

  function describe(entry) {
    return {
      state: entry.state,
      target_commit: entry.target_commit,
      requested_at: stamp(entry.requested_at),
      started_at: stamp(entry.started_at),
      finished_at: stamp(entry.finished_at),
      ...(entry.state === "completed" ? { action: entry.result.action,
        published_commit: entry.result.publication.repository_commit,
        revalidate_not_before: stamp(entry.finished_at + revalidateAfterMs) } : {}),
      ...(entry.state === "failed" ? { failure: structuredClone(entry.failure),
        retry: { consecutive_failures: entry.consecutive_failures,
          not_before: stamp(entry.retry_not_before) } } : {})
    };
  }

  function finish(entry, outcome) {
    running -= 1;
    entry.handle = null;
    entry.finished_at = now();
    if (outcome.ok) {
      entry.state = "completed";
      entry.result = { action: outcome.value.action ?? null, publication: { ...outcome.value.publication },
        worker_exit: outcome.value.worker_exit ?? null };
      entry.verified = { ...outcome.value.publication };
      entry.failure = null;
      entry.consecutive_failures = 0;
      entry.retry_not_before = null;
    } else {
      const error = outcome.error;
      entry.state = "failed";
      entry.consecutive_failures += 1;
      entry.failure = { code: typeof error?.code === "string" ? error.code : "sidecar_refresh_failed",
        message: projectFailureDiagnosis(error).message,
        diagnosis: projectFailureDiagnosis(error),
        ...(error?.details ? { details: Object.fromEntries(Object.entries(error.details)
          .filter(([key]) => key !== "diagnostics")) } : {}),
        subject: { repository: entry.repoRoot, cache: entry.cacheDir, target_commit: entry.target_commit },
        correction: "Correct the reported repository, cache or worker failure before retrying; publication_outcome states the known effects." };
      entry.retry_not_before = entry.finished_at +
        Math.min(retryBaseMs * 2 ** (entry.consecutive_failures - 1), retryMaxMs);
    }
    const settle = entry.settle;
    entry.settle = null;
    entry.settled = null;
    settle?.();
    pump();
  }

  function start(entry) {
    running += 1;
    entry.state = "running";
    entry.started_at = now();
    let handle;
    try {
      handle = launchWorker({ repoRoot: entry.repoRoot, cacheDir: entry.cacheDir,
        targetCommit: entry.target_commit });
    } catch (error) {
      finish(entry, { ok: false, error });
      return;
    }
    entry.handle = handle;
    Promise.resolve(handle.done).then((value) => finish(entry, { ok: true, value }),
      (error) => finish(entry, { ok: false, error }));
  }

  function pump() {
    while (!closed && running < maxRunning && queue.length > 0) start(queue.shift());
  }

  return Object.freeze({

    request({ repoRoot, cacheDir, currentHead, publication = null }) {
      const key = keyOf(repoRoot, cacheDir);
      let entry = entries.get(key);
      if (entry && (entry.state === "queued" || entry.state === "running")) return describe(entry);

      const current = publication !== null && publication.repository_commit === currentHead &&
        entry?.verified && samePublication(entry.verified, publication) &&
        now() - entry.finished_at < revalidateAfterMs;
      if (current) return describe(entry);
      if (entry?.state === "failed" && now() < entry.retry_not_before) return describe(entry);
      if (closed) {
        return { state: "rejected", reason: "refresh_coordinator_closed", target_commit: currentHead };
      }
      if (running >= maxRunning && queue.length >= maxQueued) {
        return { state: "rejected", reason: "refresh_queue_full", target_commit: currentHead,
          running, queued: queue.length };
      }
      if (!entry) {
        entry = { repoRoot, cacheDir, state: "idle", verified: null, failure: null, result: null,
          consecutive_failures: 0, retry_not_before: null, handle: null, settle: null, settled: null };
        entries.set(key, entry);
      }
      entry.state = "queued";
      entry.target_commit = currentHead;
      entry.requested_at = now();
      entry.started_at = null;
      entry.finished_at = null;
      entry.settled = new Promise((resolve) => { entry.settle = resolve; });
      queue.push(entry);
      pump();
      return describe(entry);
    },

    observe({ repoRoot, cacheDir }) {
      const entry = entries.get(keyOf(repoRoot, cacheDir));
      return entry ? describe(entry) : { state: "idle", target_commit: null, requested_at: null,
        started_at: null, finished_at: null };
    },

    async settled({ repoRoot, cacheDir }) {
      await entries.get(keyOf(repoRoot, cacheDir))?.settled;
    },

    async drain() {
      for (;;) {
        const pending = [...entries.values()].map((entry) => entry.settled).filter(Boolean);
        if (pending.length === 0) return;
        await Promise.all(pending);
      }
    },

    async close() {
      closed = true;
      queue.length = 0;
      const pending = [];
      for (const entry of entries.values()) {
        if (entry.state === "queued") {
          entry.state = "idle";
          entry.settle?.();
          entry.settle = null;
          entry.settled = null;
        } else if (entry.state === "running" && entry.handle) {
          pending.push(entry.settled);
          entry.handle.terminate();
        }
      }
      await Promise.all(pending);
    }
  });
}

let defaultCoordinator = null;

export function sidecarRefreshCoordinator() {
  defaultCoordinator ??= createSidecarRefreshCoordinator();
  return defaultCoordinator;
}
