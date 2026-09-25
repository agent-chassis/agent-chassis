

import { constants as fsConstants, fstatSync, openSync, write } from "node:fs";
import net from "node:net";

const DEFAULT_MAX_QUEUE_BYTES = 1024 * 1024;
const EAGAIN_RETRY_MS = 5;

function createFdSink({ fd, label, maxQueueBytes, onDrain, onError, transport = "fs" }) {
  const queue = [];
  let queuedBytes = 0;
  let inFlight = false;
  let failure = null;
  let droppedBytes = 0;
  let writtenBytes = 0;
  let retryTimer = null;
  let overflowReported = false;
  const drainWaiters = new Set();

  function notifyIdle() {
    if (queuedBytes !== 0 || inFlight) return;
    for (const resolve of drainWaiters) resolve(true);
    drainWaiters.clear();
  }

  function fail(error) {
    if (failure !== null) return;
    failure = Object.freeze({ sink: label, code: error?.code ?? "EIO",
      message: String(error?.message ?? error).slice(0, 512) });
    droppedBytes += queuedBytes;
    queue.length = 0;
    queuedBytes = 0;
    notifyIdle();
    onError(failure);
  }

  function pump() {
    if (inFlight || failure !== null || queue.length === 0) return;
    inFlight = true;
    const head = queue[0];
    write(fd, head, 0, head.length, null, (error, written) => {
      inFlight = false;
      if (error) {
        if (error.code === "EAGAIN" || error.code === "EWOULDBLOCK") {
          retryTimer = setTimeout(() => { retryTimer = null; pump(); }, EAGAIN_RETRY_MS);
          return;
        }
        fail(error);
        return;
      }
      if (failure !== null) return;
      writtenBytes += written;
      queuedBytes -= written;
      if (written < head.length) queue[0] = head.subarray(written);
      else queue.shift();
      if (queuedBytes < maxQueueBytes) onDrain();
      if (queue.length === 0) notifyIdle();
      else pump();
    });
  }

  return Object.freeze({

    enqueue(chunk, { force = false } = {}) {
      if (failure !== null) {
        droppedBytes += chunk.length;
        return true;
      }
      if (force && queuedBytes + chunk.length > 2 * maxQueueBytes) {
        droppedBytes += chunk.length;
        if (overflowReported) return true;
        overflowReported = true;
        onError(Object.freeze({ sink: label, code: "QUEUE_OVERFLOW",
          message: `${label} queue exceeded its bound while settling; bytes were dropped` }), { soft: true });
        return true;
      }
      queue.push(Buffer.from(chunk));
      queuedBytes += chunk.length;
      pump();
      return queuedBytes < maxQueueBytes;
    },
    drained() {
      if (queuedBytes === 0 && !inFlight) return Promise.resolve(true);
      return new Promise((resolve) => drainWaiters.add(resolve));
    },
    cancelRetry() {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
    },
    get pressured() { return failure === null && queuedBytes >= maxQueueBytes; },
    get failure() { return failure; },
    get stats() {
      return Object.freeze({ sink: label, transport, written_bytes: writtenBytes, dropped_bytes: droppedBytes,
        queued_bytes: queuedBytes, failure });
    }
  });
}

function createSocketSink({ fd, label, maxQueueBytes, onDrain, onError }) {
  const socket = new net.Socket({ fd, readable: false, writable: true });

  socket.unref();
  let failure = null;
  let droppedBytes = 0;
  let writtenBytes = 0;
  let overflowReported = false;
  const drainWaiters = new Set();

  function idle() {
    return socket.writableLength === 0;
  }
  function notifyIdle() {
    if (!idle() && failure === null) return;
    for (const resolve of drainWaiters) resolve(true);
    drainWaiters.clear();
  }
  function fail(error) {
    if (failure !== null) return;
    failure = Object.freeze({ sink: label, code: error?.code ?? "EIO",
      message: String(error?.message ?? error).slice(0, 512) });
    droppedBytes += socket.writableLength;
    socket.destroy();
    notifyIdle();
    onError(failure);
  }
  socket.on("error", fail);
  socket.on("drain", () => {
    onDrain();
    notifyIdle();
  });

  return Object.freeze({
    enqueue(chunk, { force = false } = {}) {
      if (failure !== null) {
        droppedBytes += chunk.length;
        return true;
      }
      if (force && socket.writableLength + chunk.length > 2 * maxQueueBytes) {
        droppedBytes += chunk.length;
        if (!overflowReported) {
          overflowReported = true;
          onError(Object.freeze({ sink: label, code: "QUEUE_OVERFLOW",
            message: `${label} queue exceeded its bound while settling; bytes were dropped` }), { soft: true });
        }
        return true;
      }
      const bytes = Buffer.from(chunk);
      socket.write(bytes, (error) => {
        if (error) return;
        writtenBytes += bytes.length;
        if (socket.writableLength < maxQueueBytes) onDrain();
        notifyIdle();
      });
      return socket.writableLength < maxQueueBytes;
    },
    drained() {
      if (idle() || failure !== null) return Promise.resolve(true);
      return new Promise((resolve) => drainWaiters.add(resolve));
    },
    cancelRetry() {},
    get pressured() { return failure === null && socket.writableLength >= maxQueueBytes; },
    get failure() { return failure; },
    get stats() {
      return Object.freeze({ sink: label, transport: "stream", written_bytes: writtenBytes,
        dropped_bytes: droppedBytes, queued_bytes: failure === null ? socket.writableLength : 0, failure });
    }
  });
}

function createSink(options) {
  let stat = null;
  try {
    stat = fstatSync(options.fd);
  } catch {

  }
  if (stat !== null && (stat.isFIFO() || stat.isSocket())) return createSocketSink(options);
  if (stat !== null && stat.isCharacterDevice()) {
    let own;
    try {
      own = openSync(`/proc/self/fd/${options.fd}`,
        fsConstants.O_WRONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOCTTY);
    } catch {

      return createFdSink({ ...options, transport: "fs-blocking-device" });
    }
    return createFdSink({ ...options, fd: own, transport: "fs-nonblocking-device" });
  }
  return createFdSink(options);
}

export function createRunnerOutput({ stdoutFd = 1, stderrFd = 2,
  maxQueueBytes = DEFAULT_MAX_QUEUE_BYTES, onFailure = () => {} } = {}) {
  const failures = [];
  const reliefListeners = new Set();
  const failureListeners = new Set([onFailure]);
  let settling = false;
  const logs = { stdout: null, stderr: null };

  function relief() {
    if (anyPressured()) return;
    for (const listener of reliefListeners) listener();
  }
  function sinkError(failure, { soft = false } = {}) {
    failures.push(failure);
    for (const listener of failureListeners) listener(failure, { soft });
  }
  const destinations = {
    stdout: createSink({ fd: stdoutFd, label: "stdout", maxQueueBytes, onDrain: relief, onError: sinkError }),
    stderr: createSink({ fd: stderrFd, label: "stderr", maxQueueBytes, onDrain: relief, onError: sinkError })
  };
  function sinksFor(stream) {
    return [destinations[stream], logs[stream]].filter((sink) => sink !== null);
  }
  function anyPressured() {
    return [...Object.values(destinations), ...Object.values(logs)]
      .some((sink) => sink !== null && sink.pressured);
  }

  function forward(stream, chunk) {
    let accepting = true;
    for (const sink of sinksFor(stream)) {
      if (!sink.enqueue(chunk, { force: settling })) accepting = false;
    }
    return settling || accepting;
  }

  function message(text) {
    forward("stderr", Buffer.from(text, "utf8"));
  }

  function attachLogs({ stdoutLogFd, stderrLogFd }) {
    logs.stdout = createFdSink({ fd: stdoutLogFd, label: "stdout.log", maxQueueBytes,
      onDrain: relief, onError: sinkError });
    logs.stderr = createFdSink({ fd: stderrLogFd, label: "stderr.log", maxQueueBytes,
      onDrain: relief, onError: sinkError });
  }

  async function drain(budgetMs) {
    const all = [...Object.values(destinations), ...Object.values(logs)].filter(Boolean);
    let timer;
    const expired = new Promise((resolve) => { timer = setTimeout(() => resolve(false), budgetMs); });
    try {
      return await Promise.race([Promise.all(all.map((sink) => sink.drained())).then(() => true), expired]);
    } finally {
      clearTimeout(timer);
      for (const sink of all) sink.cancelRetry();
    }
  }

  return Object.freeze({
    forward,
    message,
    attachLogs,
    drain,

    settle() { settling = true; relief(); },
    onRelief(listener) { reliefListeners.add(listener); },
    onFailureObserved(listener) { failureListeners.add(listener); },
    get pressured() { return anyPressured(); },
    get failures() { return Object.freeze([...failures]); },
    stats() {
      return Object.freeze([...Object.values(destinations), ...Object.values(logs)]
        .filter(Boolean).map((sink) => sink.stats));
    }
  });
}
