

const STDERR_TAIL_LIMIT = 4000;

export function createFrameParser() {
  let buffer = "";

  return {
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      const frames = [];
      while (true) {
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd === -1) break;
        const raw = buffer.slice(0, lineEnd).replace(/\r$/, "");
        buffer = buffer.slice(lineEnd + 1);
        if (raw.trim() === "") continue;
        try {
          frames.push({ ok: true, raw, message: JSON.parse(raw) });
        } catch (error) {
          frames.push({ ok: false, raw, error });
        }
      }
      return frames;
    },

    get pendingBytes() {
      return buffer;
    }
  };
}

function formatExit(exitInfo) {
  if (!exitInfo) return "still running";
  const code = exitInfo.code === null ? "null" : String(exitInfo.code);
  const signal = exitInfo.signal === null ? "null" : String(exitInfo.signal);
  return `code=${code} signal=${signal}`;
}

export function createChildFrameReader(child, { label = "child" } = {}) {
  const parser = createFrameParser();
  const frames = [];
  const waiters = new Set();
  let stderrText = "";
  let exitInfo = null;
  let stdoutEnded = false;
  let spawnError = null;
  let disposed = false;

  const stderrTail = () =>
    (stderrText.length > STDERR_TAIL_LIMIT ? stderrText.slice(-STDERR_TAIL_LIMIT) : stderrText) ||
    "none";

  function terminalError(reason) {
    return new Error(
      `${label}: ${reason}; exit=${formatExit(exitInfo)}; ` +
        `frames_observed=${frames.length}; unterminated_bytes=${JSON.stringify(parser.pendingBytes)}; ` +
        `stderr=${stderrTail()}`
    );
  }

  function rejectAllWaiters(reason) {
    if (waiters.size === 0) return;
    const error = terminalError(reason);
    for (const waiter of [...waiters]) {
      waiters.delete(waiter);
      waiter.reject(error);
    }
  }

  function offerToWaiters(frame) {
    for (const waiter of [...waiters]) {
      if (waiter.matches(frame)) {
        waiters.delete(waiter);
        waiter.resolve(frame);
      }
    }
  }

  const onStdoutData = (chunk) => {
    for (const frame of parser.push(chunk)) {
      frames.push(frame);
      offerToWaiters(frame);
    }
  };
  const onStdoutEnd = () => {
    stdoutEnded = true;

    rejectAllWaiters(
      parser.pendingBytes === ""
        ? "stdout reached EOF before a matching frame arrived"
        : "stdout reached EOF mid-frame (truncated frame)"
    );
  };
  const onStderrData = (chunk) => {
    stderrText += Buffer.from(chunk).toString("utf8");
  };
  const onExit = (code, signal) => {
    exitInfo = { code, signal };
    rejectAllWaiters("process exited before a matching frame arrived");
  };
  const onError = (error) => {
    spawnError = error;
    rejectAllWaiters(`process error: ${error.message}`);
  };

  child.stdout.on("data", onStdoutData);
  child.stdout.on("end", onStdoutEnd);
  child.stderr.on("data", onStderrData);
  child.on("exit", onExit);
  child.on("error", onError);

  function waitForFrame(predicate = () => true) {
    const matches = (frame) => frame.ok && predicate(frame.message, frame);
    for (const frame of frames) {
      if (matches(frame)) return Promise.resolve(frame);
    }
    if (disposed) return Promise.reject(terminalError("reader disposed"));
    if (spawnError) return Promise.reject(terminalError(`process error: ${spawnError.message}`));
    if (exitInfo) return Promise.reject(terminalError("process already exited"));
    if (stdoutEnded) return Promise.reject(terminalError("stdout already reached EOF"));
    return new Promise((resolve, reject) => {
      waiters.add({ matches, resolve, reject });
    });
  }

  const waitForResponse = (id) => waitForFrame((message) => message?.id === id);

  function waitForExit() {
    if (exitInfo) return Promise.resolve(exitInfo);
    return new Promise((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    rejectAllWaiters("reader disposed before a matching frame arrived");
    child.stdout.off("data", onStdoutData);
    child.stdout.off("end", onStdoutEnd);
    child.stderr.off("data", onStderrData);
    child.off("exit", onExit);
    child.off("error", onError);
  }

  return {
    child,
    waitForFrame,
    waitForResponse,
    waitForExit,
    dispose,
    get frames() {
      return [...frames];
    },
    get stderr() {
      return stderrText;
    },
    get exitInfo() {
      return exitInfo;
    },
    get stdoutEnded() {
      return stdoutEnded;
    },
    get disposed() {
      return disposed;
    },
    get listenerCounts() {
      return {
        stdoutData: child.stdout.listenerCount("data"),
        stdoutEnd: child.stdout.listenerCount("end"),
        stderrData: child.stderr.listenerCount("data"),
        exit: child.listenerCount("exit"),
        error: child.listenerCount("error")
      };
    }
  };
}
