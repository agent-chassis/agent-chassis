import { spawn } from "node:child_process";

import { startComponentSpan } from "./test-component-journal.mjs";

export const MANAGED_TEST_PROCESS_ERROR_CODES = Object.freeze({
  INVALID_CHILD: "managed_test_process.invalid_child.v1",
  INVALID_SPEC: "managed_test_process.invalid_spec.v1",
  INVALID_OPTIONS: "managed_test_process.invalid_options.v1",
  TERMINAL_TIMEOUT: "managed_test_process.terminal_timeout.v1"
});

export class ManagedTestProcessError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "ManagedTestProcessError";
    this.code = code;
    if (options.detail !== undefined) this.detail = options.detail;
  }
}

const DEFAULT_TAIL_BYTES = 16 * 1024;
const DEFAULT_NATURAL_EXIT_MS = 100;
const DEFAULT_SIGTERM_MS = 500;
const DEFAULT_SIGKILL_MS = 500;
const ownedProcessGroupChildren = new WeakSet();

function fail(code, message) {
  throw new ManagedTestProcessError(code, message);
}

function boundedInteger(value, fallback, name) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 0) {
    fail(MANAGED_TEST_PROCESS_ERROR_CODES.INVALID_OPTIONS,
      `${name} must be a non-negative integer`);
  }
  return resolved;
}

function isUtf8Continuation(byte) {
  return byte >= 0x80 && byte <= 0xbf;
}

function validUtf8SequenceLength(value, index) {
  const first = value[index];
  if (first <= 0x7f) return 1;

  const second = value[index + 1];
  if (first >= 0xc2 && first <= 0xdf) {
    return isUtf8Continuation(second) ? 2 : 0;
  }

  const third = value[index + 2];
  if (first === 0xe0) {
    return second >= 0xa0 && second <= 0xbf && isUtf8Continuation(third) ? 3 : 0;
  }
  if ((first >= 0xe1 && first <= 0xec) || (first >= 0xee && first <= 0xef)) {
    return isUtf8Continuation(second) && isUtf8Continuation(third) ? 3 : 0;
  }
  if (first === 0xed) {
    return second >= 0x80 && second <= 0x9f && isUtf8Continuation(third) ? 3 : 0;
  }

  const fourth = value[index + 3];
  if (first === 0xf0) {
    return second >= 0x90 && second <= 0xbf &&
      isUtf8Continuation(third) && isUtf8Continuation(fourth) ? 4 : 0;
  }
  if (first >= 0xf1 && first <= 0xf3) {
    return isUtf8Continuation(second) && isUtf8Continuation(third) &&
      isUtf8Continuation(fourth) ? 4 : 0;
  }
  if (first === 0xf4) {
    return second >= 0x80 && second <= 0x8f &&
      isUtf8Continuation(third) && isUtf8Continuation(fourth) ? 4 : 0;
  }
  return 0;
}

function validUtf8SuffixStart(value) {
  let suffixStart = 0;
  for (let index = 0; index < value.length;) {
    const sequenceLength = validUtf8SequenceLength(value, index);
    if (sequenceLength === 0) {
      index += 1;
      suffixStart = index;
    } else {
      index += sequenceLength;
    }
  }
  return suffixStart;
}

function createTail(limit) {
  let value = Buffer.alloc(0);
  return Object.freeze({
    append(chunk) {
      if (limit === 0) return;
      const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (next.length >= limit) {
        value = next.subarray(next.length - limit);
      } else {
        value = Buffer.concat([value, next]);
        if (value.length > limit) value = value.subarray(value.length - limit);
      }
    },
    read() {
      return value.subarray(validUtf8SuffixStart(value)).toString("utf8");
    }
  });
}

function snapshotError(error) {
  if (error === null || error === undefined) return null;
  return Object.freeze({
    name: typeof error.name === "string" ? error.name : "Error",
    message: typeof error.message === "string" ? error.message : String(error),
    code: typeof error.code === "string" || typeof error.code === "number"
      ? error.code
      : null
  });
}

export function manageTestProcess(child, options = {}) {
  if (child === null || typeof child !== "object" ||
      typeof child.on !== "function" || typeof child.removeListener !== "function" ||
      typeof child.kill !== "function") {
    fail(MANAGED_TEST_PROCESS_ERROR_CODES.INVALID_CHILD,
      "managed test process requires a ChildProcess-compatible object");
  }

  const displayLabel = options.displayLabel ?? "managed test process";
  if (typeof displayLabel !== "string" || displayLabel.length === 0) {
    fail(MANAGED_TEST_PROCESS_ERROR_CODES.INVALID_OPTIONS,
      "displayLabel must be a non-empty string");
  }
  const stdoutLimit = boundedInteger(options.stdoutTailBytes,
    DEFAULT_TAIL_BYTES, "stdoutTailBytes");
  const stderrLimit = boundedInteger(options.stderrTailBytes,
    DEFAULT_TAIL_BYTES, "stderrTailBytes");
  const naturalExitTimeoutMs = boundedInteger(options.naturalExitTimeoutMs,
    DEFAULT_NATURAL_EXIT_MS, "naturalExitTimeoutMs");
  const sigtermTimeoutMs = boundedInteger(options.sigtermTimeoutMs,
    DEFAULT_SIGTERM_MS, "sigtermTimeoutMs");
  const sigkillTimeoutMs = boundedInteger(options.sigkillTimeoutMs,
    DEFAULT_SIGKILL_MS, "sigkillTimeoutMs");
  const ownsProcessGroup = ownedProcessGroupChildren.has(child);

  const lifetimeSpan = startComponentSpan({ owner: "managed-test-process", kind: "subprocess",
    label: displayLabel });
  const stdoutTail = createTail(stdoutLimit);
  const stderrTail = createTail(stderrLimit);
  const timers = new Set();
  let exitCode = child.exitCode ?? null;
  let exitSignal = child.signalCode ?? null;
  let closeCode = null;
  let closeSignal = null;
  let processError = null;
  let terminal = exitCode !== null || exitSignal !== null;
  let settled = false;
  let detached = false;
  let terminalResult = null;
  let stopPromise;
  let processGroupTerminationPromise;
  let observedClose = null;
  let resolveTerminal;
  let rejectTerminal;
  const terminalPromise = new Promise((resolve, reject) => {
    resolveTerminal = resolve;
    rejectTerminal = reject;
  });
  void terminalPromise.catch(() => {});

  const onStdout = (chunk) => stdoutTail.append(chunk);
  const onStderr = (chunk) => stderrTail.append(chunk);
  const onError = (error) => {
    if (processError === null) processError = snapshotError(error);
    if (child.pid === undefined || child.pid === null) terminal = true;
  };
  const onExit = (code, signal) => {
    terminal = true;
    if (exitCode === null) exitCode = code ?? null;
    if (exitSignal === null) exitSignal = signal ?? null;
  };

  function clearTimers() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  function detach() {
    if (detached) return;
    detached = true;
    clearTimers();
    child.removeListener("error", onError);
    child.removeListener("exit", onExit);
    child.removeListener("close", onClose);
    child.stdout?.removeListener?.("data", onStdout);
    child.stderr?.removeListener?.("data", onStderr);
  }

  function makeResult() {
    return Object.freeze({
      code: exitCode,
      signal: exitSignal,
      closeCode,
      closeSignal,
      error: processError,
      stdoutTail: stdoutTail.read(),
      stderrTail: stderrTail.read()
    });
  }

  function settleSuccess(code, signal) {
    if (settled) return;
    terminal = true;
    closeCode = code ?? null;
    closeSignal = signal ?? null;
    if (exitCode === null) exitCode = code ?? null;
    if (exitSignal === null) exitSignal = signal ?? null;
    settled = true;
    terminalResult = makeResult();
    detach();
    lifetimeSpan.end("ok");
    resolveTerminal(terminalResult);
  }

  function signalProcessGroup(signal) {
    if (!Number.isInteger(child.pid) || child.pid <= 0) return false;
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      if (processError === null) processError = snapshotError(error);
      throw new ManagedTestProcessError(
        MANAGED_TEST_PROCESS_ERROR_CODES.TERMINAL_TIMEOUT,
        `${displayLabel} could not confirm its owned process group`,
        { cause: error, detail: { signal, pid: child.pid } }
      );
    }
  }

  function processGroupExists() {
    return signalProcessGroup(0);
  }

  async function waitForProcessGroupExit(milliseconds) {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      if (!processGroupExists()) return true;
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          resolve();
        }, 10);
        timers.add(timer);
      });
    }
    return !processGroupExists();
  }

  function terminateProcessGroup() {
    if (!ownsProcessGroup) return Promise.resolve(true);
    if (processGroupTerminationPromise !== undefined) return processGroupTerminationPromise;
    processGroupTerminationPromise = (async () => {
      if (!processGroupExists()) return true;
      signalProcessGroup("SIGTERM");
      if (await waitForProcessGroupExit(sigtermTimeoutMs)) return true;
      signalProcessGroup("SIGKILL");
      return waitForProcessGroupExit(sigkillTimeoutMs);
    })();
    return processGroupTerminationPromise;
  }

  function settleOwnedClose() {
    void terminateProcessGroup().then((terminated) => {
      if (terminated) return settleSuccess(observedClose.code, observedClose.signal);
      throw timeoutFailure();
    }).catch((error) => {
      if (!settled) {
        settled = true;
        detach();
        lifetimeSpan.end("failed", error);
        rejectTerminal(error);
      }
    });
  }

  function onClose(code, signal) {
    observedClose = { code, signal };
    if (!ownsProcessGroup) {
      settleSuccess(code, signal);
      return;
    }
    settleOwnedClose();
  }

  child.on("error", onError);
  child.on("exit", onExit);
  child.on("close", onClose);
  child.stdout?.on?.("data", onStdout);
  child.stderr?.on?.("data", onStderr);

  function waitForExit() {
    return terminalPromise;
  }

  function waitPhase(milliseconds) {
    if (settled) return Promise.resolve(true);
    return new Promise((resolve) => {
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        timers.delete(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(false), milliseconds);
      timers.add(timer);
      void terminalPromise.then(() => finish(true), () => finish(false));
    });
  }

  function closeStdin() {
    const stdin = child.stdin;
    if (stdin === null || stdin === undefined || stdin.destroyed || stdin.writableEnded) return;
    stdin.end();
  }

  function signalIfRunning(signal) {
    if (settled) return false;
    if (ownsProcessGroup) return signalProcessGroup(signal);
    if (terminal) return false;
    try {
      return child.kill(signal);
    } catch (error) {
      if (processError === null) processError = snapshotError(error);
      return false;
    }
  }

  function timeoutFailure() {
    const detail = Object.freeze({
      displayLabel,
      terminal: Object.freeze({
        exitCode,
        exitSignal,
        closeCode,
        closeSignal,
        error: processError
      }),
      stdoutTail: stdoutTail.read(),
      stderrTail: stderrTail.read()
    });
    return new ManagedTestProcessError(
      MANAGED_TEST_PROCESS_ERROR_CODES.TERMINAL_TIMEOUT,
      `${displayLabel} did not reach terminal close after SIGKILL`,
      { detail }
    );
  }

  async function runStop() {
    closeStdin();
    if (await waitPhase(naturalExitTimeoutMs)) return terminalResult;
    if (ownsProcessGroup) {
      let terminated;
      try {
        terminated = await terminateProcessGroup();
      } catch (error) {
        if (!settled) {
          settled = true;
          detach();
          lifetimeSpan.end("failed", error);
          rejectTerminal(error);
        }
        throw error;
      }
      if (terminated && await waitPhase(sigkillTimeoutMs)) return terminalResult;
      const error = timeoutFailure();
      if (!settled) {
        settled = true;
        detach();
        lifetimeSpan.end("failed", error);
        rejectTerminal(error);
      }
      throw error;
    }
    signalIfRunning("SIGTERM");
    if (await waitPhase(sigtermTimeoutMs)) return terminalResult;
    signalIfRunning("SIGKILL");
    if (await waitPhase(sigkillTimeoutMs)) return terminalResult;

    const error = timeoutFailure();
    if (!settled) {
      settled = true;
      detach();
      lifetimeSpan.end("failed", error);
      rejectTerminal(error);
    }
    throw error;
  }

  function stop() {
    if (stopPromise === undefined) stopPromise = runStop();
    return stopPromise;
  }

  function dispose() {
    return stop();
  }

  return Object.freeze({
    child,
    waitForExit,
    stop,
    dispose,
    get stdoutTail() { return stdoutTail.read(); },
    get stderrTail() { return stderrTail.read(); },
    get terminalResult() { return terminalResult; }
  });
}

export function spawnManagedTestProcess(spec, options = {}) {
  if (spec === null || typeof spec !== "object" ||
      typeof spec.command !== "string" || spec.command.length === 0 ||
      (spec.args !== undefined && !Array.isArray(spec.args)) ||
      (spec.spawnOptions !== undefined &&
        (spec.spawnOptions === null || typeof spec.spawnOptions !== "object"))) {
    fail(MANAGED_TEST_PROCESS_ERROR_CODES.INVALID_SPEC,
      "managed test process spawn spec requires command, optional args, and optional spawnOptions");
  }
  if (spec.spawnOptions?.detached === false && process.platform !== "win32") {
    fail(MANAGED_TEST_PROCESS_ERROR_CODES.INVALID_SPEC,
      "managed test process spawn cannot disable owned process-group isolation");
  }
  if (process.platform === "win32") {
    fail(MANAGED_TEST_PROCESS_ERROR_CODES.INVALID_SPEC,
      "managed test process groups are unsupported on win32");
  }
  const spawnOptions = spec.spawnOptions ?? {};

  const env = spawnOptions.env !== null && typeof spawnOptions.env === "object"
    ? { env: { ...spawnOptions.env } }
    : {};
  const child = spawn(spec.command, spec.args ?? [], {
    ...spawnOptions,
    ...env,
    detached: true
  });
  ownedProcessGroupChildren.add(child);
  return manageTestProcess(child, options);
}
