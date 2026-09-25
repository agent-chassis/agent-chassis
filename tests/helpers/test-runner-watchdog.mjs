import { performance } from "node:perf_hooks";

import { createBoundedLineReader } from "./bounded-line-reader.mjs";
import {
  OBSERVER_MAX_FRAME_BYTES, ObserverProtocolViolation, decodeObserverFrame
} from "./test-runner-observer-protocol.mjs";

export const TEST_RUNNER_WATCHDOG_CODES = Object.freeze({
  STARTUP_TIMEOUT: "test_runner.observer_startup_timeout.v1",
  PROTOCOL: "test_runner.observer_protocol_invalid.v1",
  LOST: "test_runner.observer_lost.v1",
  FILE_TIMEOUT: "test_runner.file_timeout.v1",
  PHASE_TIMEOUT: "test_runner.phase_timeout.v1",
  TERMINATION_FAILED: "test_runner.termination_failed.v1"
});

export class TestRunnerWatchdogError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "TestRunnerWatchdogError";
    this.code = code;
    this.detail = Object.freeze(detail);
  }
}

function protocol(message) {
  return new TestRunnerWatchdogError(TEST_RUNNER_WATCHDOG_CODES.PROTOCOL, message);
}

function checkedFrame(bytes) {
  try {
    return decodeObserverFrame(bytes);
  } catch (error) {
    if (error instanceof ObserverProtocolViolation) throw protocol(error.message);
    throw error;
  }
}

export function createObserverFrameReader({ onFrame, onFailure }) {
  return createBoundedLineReader({
    maxLineBytes: OBSERVER_MAX_FRAME_BYTES,
    eofPolicy: "reject",
    onLine: (bytes) => onFrame(checkedFrame(bytes)),
    onFailure: (failure) => {
      if (failure.kind === "consumer") return onFailure(failure.error);
      onFailure(protocol(failure.kind === "trailing"
        ? "observer pipe ended with an incomplete frame" : "observer frame exceeded 16 KiB"));
    }
  });
}

export function createTestRunnerWatchdog({ files, fileTimeoutMs, phaseTimeoutMs,
  onProgress, onFailure, onRecordingFailure = () => {}, allowUnscheduledFiles = false,
  clock = () => performance.now() }) {
  const selected = new Set(files);
  const active = new Map();
  const completed = new Set();
  let hello = false;
  let streamEnd = false;
  let failure = null;
  let timer = null;
  let timerKind = null;
  let phaseStarted = clock();
  let phaseName = "startup";

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    timerKind = null;
  }

  function fail(error) {
    if (failure !== null) return failure;
    failure = error;
    clearTimer();
    onFailure(error);
    return failure;
  }

  function schedule() {
    if (failure !== null) return;
    clearTimer();
    const now = clock();
    if (active.size > 0) {
      const earliest = [...active.values()].reduce((left, right) =>
        right.deadline < left.deadline ? right : left);
      timerKind = "file";
      timer = setTimeout(() => {
        const current = clock();
        const expired = [...active.values()].filter((item) => item.deadline <= current)
          .sort((left, right) => left.deadline - right.deadline)[0];
        if (expired === undefined) return schedule();
        fail(new TestRunnerWatchdogError(TEST_RUNNER_WATCHDOG_CODES.FILE_TIMEOUT,
          `file ${expired.file} exceeded its ${fileTimeoutMs}ms budget`,
          { file: expired.file, elapsedMs: Math.floor(current - expired.started), budgetMs: fileTimeoutMs }));
      }, Math.max(0, earliest.deadline - now));
      return;
    }
    timerKind = "phase";
    timer = setTimeout(() => {
      const current = clock();
      const deadline = phaseStarted + phaseTimeoutMs;
      if (current < deadline) return schedule();
      fail(new TestRunnerWatchdogError(
        phaseName === "startup" ? TEST_RUNNER_WATCHDOG_CODES.STARTUP_TIMEOUT : TEST_RUNNER_WATCHDOG_CODES.PHASE_TIMEOUT,
        `${phaseName} exceeded its ${phaseTimeoutMs}ms phase budget`,
        { phase: phaseName, elapsedMs: Math.floor(current - phaseStarted), budgetMs: phaseTimeoutMs }
      ));
    }, Math.max(0, phaseStarted + phaseTimeoutMs - now));
  }

  function accept(frame) {
    if (failure !== null) return;
    if (frame.type === "HELLO") {
      if (hello || streamEnd) return fail(protocol("duplicate or late observer HELLO"));
      hello = true;
      return;
    }
    if (!hello || streamEnd) return fail(protocol("observer event outside the active stream"));

    if (frame.type === "RECORDING_FAILURE") {
      onRecordingFailure({ code: frame.code, message: frame.message });
      return;
    }
    if (frame.type === "STREAM_END") {
      if (active.size !== 0) return fail(protocol("observer stream ended with active files"));
      streamEnd = true;
      phaseName = "terminal drain";
      phaseStarted = clock();
      schedule();
      return;
    }
    if (!selected.has(frame.file)) return fail(protocol(`observer named an unselected file: ${frame.file}`));
    if (frame.type === "FILE_START") {
      if (active.has(frame.file) || completed.has(frame.file)) {
        return fail(protocol(`duplicate file start: ${frame.file}`));
      }
      const started = clock();
      active.set(frame.file, { ...frame, started, deadline: started + fileTimeoutMs });
      onProgress({ type: "START", file: frame.file, budgetMs: fileTimeoutMs });
      schedule();
      return;
    }
    const started = active.get(frame.file);
    if (started === undefined || started.id !== frame.id) {
      return fail(protocol(`unmatched file end: ${frame.file}`));
    }
    active.delete(frame.file);
    completed.add(frame.file);
    onProgress({ type: "FINISH", file: frame.file,
      elapsedMs: Math.floor(clock() - started.started), outcome: frame.outcome });
    if (active.size === 0) {
      phaseName = "between files or reporter teardown";
      phaseStarted = clock();
    }
    schedule();
  }

  function finalize(result, { pipeEnded }) {
    clearTimer();
    if (failure !== null) return failure;
    if (!hello && result.code !== 0) return null;
    if (!pipeEnded || !hello || !streamEnd || active.size > 0 ||
        !allowUnscheduledFiles && completed.size !== selected.size) {
      return fail(new TestRunnerWatchdogError(TEST_RUNNER_WATCHDOG_CODES.LOST,
        "observer did not complete before the suite process exited",
        { hello, streamEnd, activeCount: active.size, completedCount: completed.size,
          selectedCount: selected.size, pipeEnded }));
    }
    return null;
  }

  schedule();
  return Object.freeze({ accept, fail, finalize, dispose: clearTimer,
    get failure() { return failure; }, get hello() { return hello; },
    get streamEnd() { return streamEnd; }, get timerKind() { return timerKind; },
    get activeCount() { return active.size; } });
}
