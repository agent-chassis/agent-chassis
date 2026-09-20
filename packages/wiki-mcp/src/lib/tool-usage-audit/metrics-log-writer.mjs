

import { randomBytes as cryptoRandomBytes } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import { gzip as zlibGzip } from "node:zlib";
import {
  METRIC_HEALTH_REASONS,
  buildHealthRecord,
  encodeAnonymousMetricLine,
  projectHourBucket
} from "./anonymous-metrics.mjs";

export const METRICS_LOG_WRITER_LIMITS = Object.freeze({
  maxLineBytes: 1024,
  maxPendingBytes: 256 * 1024,
  batchBytes: 64 * 1024,
  flushIntervalMs: 1000,
  maxMemberBytes: 128 * 1024,
  maxFileBytes: 16 * 1024 * 1024,
  closeDeadlineMs: 1000,
  diagnosticIntervalMs: 60 * 1000
});

export const METRICS_FILE_NAME_PATTERN = /^metrics-[0-9a-f]{32}\.jsonl\.gz$/u;
export const METRICS_DIAGNOSTIC_EVENT = "anonymous_mcp_metrics";

function gzipLevelOne(buffer) {
  return new Promise((resolve, reject) => {
    zlibGzip(buffer, { level: 1 }, (error, output) => (error ? reject(error) : resolve(output)));
  });
}

function openExclusive(filePath) {
  return open(filePath, "wx", 0o600);
}

export function createMetricsLogWriter({
  root,
  limits = METRICS_LOG_WRITER_LIMITS,
  now = () => new Date(),
  openFile = openExclusive,
  gzip = gzipLevelOne,
  randomBytes = cryptoRandomBytes,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  emitDiagnostic = null
} = {}) {
  if (typeof root !== "string" || root.length === 0) {
    throw new TypeError("metrics log writer requires an already resolved root directory");
  }

  let state = "active";
  let closing = false;
  let abandoned = false;
  let closePromise = null;
  let timer = null;
  let inflight = null;
  let inflightLines = 0;
  let file = null;
  const pending = [];
  let pendingBytes = 0;
  const healthCounts = new Map();
  const dropped = Object.fromEntries(METRIC_HEALTH_REASONS.map((reason) => [reason, 0]));
  const lastDiagnosticAt = new Map();
  const counters = {
    accepted_lines: 0,
    written_lines: 0,
    written_members: 0,
    written_bytes: 0,
    files_opened: 0,
    lost_lines: 0
  };

  const readNow = () => {
    try {
      return now();
    } catch {
      return null;
    }
  };

  const emit = (entry) => {
    if (typeof emitDiagnostic !== "function") return;
    try {
      emitDiagnostic(Object.freeze({ event: METRICS_DIAGNOSTIC_EVENT, ...entry }));
    } catch {

    }
  };

  const noteHealth = (reason) => {
    dropped[reason] += 1;
    healthCounts.set(reason, (healthCounts.get(reason) ?? 0) + 1);
    const at = readNow()?.getTime?.();
    const last = lastDiagnosticAt.get(reason);
    if (!Number.isFinite(at) || last === undefined || at - last >= limits.diagnosticIntervalMs) {
      if (Number.isFinite(at)) lastDiagnosticAt.set(reason, at);
      emit({ reason, count: dropped[reason], writer_state: state });
    }
  };

  const closeHandleQuietly = (handle) => {
    Promise.resolve()
      .then(() => handle.close())
      .catch(() => {});
  };

  const fail = (reason) => {
    if (abandoned) return;
    counters.lost_lines += inflightLines + pending.length;
    inflightLines = 0;
    pending.length = 0;
    pendingBytes = 0;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (state === "active") state = "disabled";
    noteHealth(reason);
    const current = file;
    file = null;
    if (current !== null) closeHandleQuietly(current.handle);
  };

  const ensureFile = async (hourUtc, memberLength) => {
    if (file !== null && (file.hour !== hourUtc || file.bytes + memberLength > limits.maxFileBytes)) {
      const previous = file;
      file = null;
      await previous.handle.close();
      if (abandoned) return null;
    }
    if (file === null) {
      const name = `metrics-${randomBytes(16).toString("hex")}.jsonl.gz`;
      const handle = await openFile(path.join(root, name));
      if (abandoned) {
        closeHandleQuietly(handle);
        return null;
      }
      file = { handle, bytes: 0, hour: hourUtc };
      counters.files_opened += 1;
    }
    return file;
  };

  const writeAll = async (handle, buffer) => {
    let offset = 0;
    while (offset < buffer.length) {
      if (abandoned) return false;
      const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, null);
      if (!Number.isInteger(bytesWritten) || bytesWritten <= 0) {
        throw new Error("metrics write made no progress");
      }
      offset += bytesWritten;
    }
    return true;
  };

  const drainOnce = async () => {
    const hour = projectHourBucket(readNow());
    const lines = [];
    let batchBytes = 0;
    for (const [reason, count] of healthCounts) {
      const line = encodeAnonymousMetricLine(buildHealthRecord({ hour, reason, count }));
      if (line !== null) {
        lines.push(line);
        batchBytes += Buffer.byteLength(line, "utf8");
      }
    }
    healthCounts.clear();
    let metricLines = 0;
    while (pending.length > 0) {
      const size = Buffer.byteLength(pending[0], "utf8");
      if (lines.length > 0 && batchBytes + size > limits.batchBytes) break;
      lines.push(pending.shift());
      pendingBytes -= size;
      batchBytes += size;
      metricLines += 1;
    }
    if (lines.length === 0) return;
    inflightLines = metricLines;

    let member;
    try {
      member = await gzip(Buffer.from(lines.join(""), "utf8"));
    } catch {
      fail("compression_failed");
      return;
    }
    if (!Buffer.isBuffer(member) || member.length > limits.maxMemberBytes) {
      fail("compression_failed");
      return;
    }

    if (abandoned) return;
    let current;
    try {
      current = await ensureFile(hour.hour_utc, member.length);
      if (current === null || !(await writeAll(current.handle, member))) return;
    } catch {
      fail("file_failed");
      return;
    }
    current.bytes += member.length;
    if (abandoned) return;
    inflightLines = 0;
    counters.written_lines += metricLines;
    counters.written_members += 1;
    counters.written_bytes += member.length;
  };

  const startDrain = () => {
    if (inflight !== null) return inflight;
    if (state !== "active" || (pending.length === 0 && healthCounts.size === 0)) {
      return Promise.resolve();
    }
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    inflight = drainOnce()
      .catch(() => fail("file_failed"))
      .then(() => {
        inflight = null;
        if (!closing) schedule();
      });
    return inflight;
  };

  function schedule() {
    if (inflight !== null || state !== "active" || closing || pending.length === 0) return;
    if (pendingBytes >= limits.batchBytes) {
      startDrain();
      return;
    }
    if (timer === null) {
      timer = setTimer(() => {
        timer = null;
        startDrain();
      }, limits.flushIntervalMs);
      timer?.unref?.();
    }
  }

  const enqueue = (record) => {
    try {
      if (closing || state === "closed") {
        noteHealth("late_completion");
        return false;
      }
      if (state !== "active") {
        counters.lost_lines += 1;
        return false;
      }
      const line = encodeAnonymousMetricLine(record);
      const size = line === null ? 0 : Buffer.byteLength(line, "utf8");
      if (line === null || size > limits.maxLineBytes) {
        noteHealth("invalid_record");
        return false;
      }
      if (pendingBytes + size > limits.maxPendingBytes) {
        noteHealth("queue_full");
        return false;
      }
      pending.push(line);
      pendingBytes += size;
      counters.accepted_lines += 1;
      schedule();
      return true;
    } catch {
      return false;
    }
  };

  const countHealth = (reason) => {
    try {
      if (!METRIC_HEALTH_REASONS.includes(reason)) return false;
      noteHealth(reason);
      return true;
    } catch {
      return false;
    }
  };

  const diagnostics = () => Object.freeze({
    state: state === "active" && closing ? "closing" : state,
    pending_lines: pending.length,
    pending_bytes: pendingBytes,
    inflight: inflight !== null,
    ...counters,
    dropped: Object.freeze({ ...dropped })
  });

  const close = () => {
    if (closePromise !== null) return closePromise;
    closing = true;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    closePromise = (async () => {
      let timedOut = false;
      let deadlineTimer = null;

      const deadline = new Promise((resolve) => {
        deadlineTimer = setTimer(() => {
          timedOut = true;

          abandoned = true;
          resolve();
        }, limits.closeDeadlineMs);
      });
      const flush = (async () => {
        while (state === "active" && !timedOut) {
          if (inflight !== null) {
            await inflight;
            continue;
          }
          if (pending.length === 0 && healthCounts.size === 0) break;
          await startDrain();
        }
        if (!timedOut && file !== null) {
          const current = file;
          file = null;
          await current.handle.close();
        }
      })().catch(() => {
        if (!timedOut) fail("file_failed");
      });
      await Promise.race([flush, deadline]);
      if (deadlineTimer !== null) clearTimer(deadlineTimer);

      let status;
      if (timedOut) {
        status = "timeout";
        counters.lost_lines += pending.length + inflightLines;
        inflightLines = 0;
        pending.length = 0;
        pendingBytes = 0;
        noteHealth("shutdown_timeout");
        const current = file;
        file = null;
        if (current !== null) {
          const settled = inflight ?? Promise.resolve();
          settled.then(() => closeHandleQuietly(current.handle), () => closeHandleQuietly(current.handle));
        }
      } else {
        status = state === "active" ? "flushed" : "disabled";
      }
      state = "closed";
      const summary = Object.freeze({
        status,
        accepted_lines: counters.accepted_lines,
        written_lines: counters.written_lines,
        lost_lines: counters.lost_lines,
        files_opened: counters.files_opened,
        dropped: Object.freeze({ ...dropped })
      });
      emit({ phase: "closed", ...summary });
      return summary;
    })();
    return closePromise;
  };

  return Object.freeze({ enqueue, countHealth, close, diagnostics });
}
