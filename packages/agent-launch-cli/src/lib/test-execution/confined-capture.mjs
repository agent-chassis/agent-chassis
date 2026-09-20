

import { NODE_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES } from
  "../workspace-agent-test-proof-node-observation.mjs";

export const DEFAULT_VALIDATION_TIMEOUT_MS = 30000;

export const DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS = 300000;

export const TEST_PROOF_LIVE_CLEANUP_ALLOWANCE_MS = 5000;

const EXECUTION_BUDGETS = new WeakSet();
const MAX_EXECUTION_BUDGET_MS = 2147483000;

export function mintTestProofExecutionBudget({ timeoutMs, signal = null,
  clock = () => performance.now() } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_EXECUTION_BUDGET_MS) {
    throw new TypeError("test-proof execution budget requires an integer millisecond duration");
  }
  if (signal !== null && !(signal instanceof AbortSignal)) {
    throw new TypeError("test-proof execution budget cancellation must be an AbortSignal");
  }
  const startedAt = clock();
  const deadline = startedAt + timeoutMs;
  const controller = new AbortController();
  let interruption = null;
  const interrupt = (kind) => {
    if (interruption !== null) return;
    interruption = kind;
    controller.abort(Object.assign(new Error(`test-proof execution ${kind}`), {
      code: kind === "timed_out" ? "test_proof_execution_timed_out" : "test_proof_execution_cancelled"
    }));
  };
  const timer = setTimeout(() => interrupt("timed_out"), timeoutMs);
  if (typeof timer.unref === "function") timer.unref();
  const onAbort = () => interrupt("cancelled");
  if (signal?.aborted) interrupt("cancelled");
  else signal?.addEventListener("abort", onAbort, { once: true });
  const budget = Object.freeze({
    schema_version: "workspace-agent-test-proof-execution-budget.v1",
    timeout_ms: timeoutMs,
    signal: controller.signal,
    remainingMs: () => Math.max(0, Math.floor(deadline - clock())),
    elapsedMs: () => Math.max(0, clock() - startedAt),
    interruption: () => {
      if (interruption === null && clock() >= deadline) interrupt("timed_out");
      return interruption;
    },
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  });
  EXECUTION_BUDGETS.add(budget);
  return budget;
}

export function assertTestProofExecutionBudget(value) {
  if (value === null || typeof value !== "object" || !EXECUTION_BUDGETS.has(value)) {
    throw Object.assign(new Error("test-proof execution budget must be launcher-minted"),
      { code: "test_proof_execution_budget_untrusted" });
  }
  return value;
}

export const DEFAULT_VALIDATION_OUTPUT_CAP_BYTES = 262144;

export const DEFAULT_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES =
  NODE_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES;

const OUTPUT_HEAD_CAP_FRACTION = 4;
const OUTPUT_ELISION_MARKER_RESERVE_BYTES = 160;

export function resolveValidationOutputBounds({
  outputCapBytes = null,
  outputHeadCapBytes = null,
  outputTailCapBytes = null
} = {}) {
  const positive = (value) => (Number.isInteger(value) && value > 0 ? value : null);
  const head = positive(outputHeadCapBytes);
  const tail = positive(outputTailCapBytes);
  if (head !== null || tail !== null) {
    return {
      headCapBytes: head ?? 0,
      tailCapBytes: tail ?? 0,
      totalCapBytes: (head ?? 0) + (tail ?? 0) + OUTPUT_ELISION_MARKER_RESERVE_BYTES
    };
  }
  const total = positive(outputCapBytes) ?? DEFAULT_VALIDATION_OUTPUT_CAP_BYTES;
  const headCapBytes = Math.max(1, Math.floor(total / OUTPUT_HEAD_CAP_FRACTION));
  const tailCapBytes = Math.max(
    0,
    total - headCapBytes - OUTPUT_ELISION_MARKER_RESERVE_BYTES
  );
  return { headCapBytes, tailCapBytes, totalCapBytes: total };
}

function elisionMarker(elidedBytes, headCapBytes, tailCapBytes) {
  return (
    `\n[launcher output bound: ${elidedBytes} byte(s) elided from the middle; ` +
    `first ${headCapBytes} and last ${tailCapBytes} byte(s) retained]\n`
  );
}

function createBoundedSink({ headCapBytes, tailCapBytes }) {
  const headChunks = [];
  let headBytes = 0;

  let tailChunks = [];
  let tailBytes = 0;
  let elidedBytes = 0;

  function pushTail(buf) {
    if (tailCapBytes === 0) {
      elidedBytes += buf.length;
      return;
    }
    tailChunks.push(buf);
    tailBytes += buf.length;
    while (tailBytes > tailCapBytes) {
      const overflow = tailBytes - tailCapBytes;
      const front = tailChunks[0];
      if (front.length <= overflow) {
        tailChunks.shift();
        tailBytes -= front.length;
        elidedBytes += front.length;
      } else {
        tailChunks[0] = front.subarray(overflow);
        tailBytes -= overflow;
        elidedBytes += overflow;
      }
    }
  }

  return {
    push(chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      if (buf.length === 0) return;
      if (headBytes < headCapBytes) {
        const room = headCapBytes - headBytes;
        if (buf.length <= room) {
          headChunks.push(buf);
          headBytes += buf.length;
          return;
        }
        headChunks.push(buf.subarray(0, room));
        headBytes = headCapBytes;
        pushTail(buf.subarray(room));
        return;
      }
      pushTail(buf);
    },
    result() {
      const head = Buffer.concat(headChunks);
      const tail = Buffer.concat(tailChunks);
      if (elidedBytes === 0) {
        return {
          text: Buffer.concat([head, tail]).toString("utf8"),
          truncated: false,
          elided_bytes: 0
        };
      }
      const marker = Buffer.from(
        elisionMarker(elidedBytes, headCapBytes, tailCapBytes),
        "utf8"
      );
      return {
        text: Buffer.concat([head, marker, tail]).toString("utf8"),
        truncated: true,
        elided_bytes: elidedBytes
      };
    }
  };
}

function createReporterProtocolSink(capBytes) {
  const chunks = [];
  let retainedBytes = 0;
  let observedBytes = 0;
  let overflowed = false;

  return {
    push(chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      if (buf.length === 0) return;
      observedBytes += buf.length;
      if (overflowed) return;
      if (retainedBytes + buf.length > capBytes) {
        overflowed = true;
        retainedBytes = 0;
        chunks.length = 0;
        return;
      }
      chunks.push(buf);
      retainedBytes += buf.length;
    },
    result() {
      const bytes = overflowed ? Buffer.alloc(0) : Buffer.concat(chunks, retainedBytes);
      return {
        text: bytes.toString("utf8"),
        bytes,
        truncated: overflowed,
        elided_bytes: overflowed ? observedBytes - capBytes : 0,
        protocol_overflow: overflowed
      };
    }
  };
}

export function spawnAndCapture(plan, {
  spawnIsolated,
  parentEnv,
  timeoutMs,
  outputBounds,
  reporterProtocol,
  clock,
  signal = null,
  cleanupAllowanceMs = null,
  stdinPayload = null
}) {
  const stdin = stdinPayload === null ? "ignore" : "pipe";
  const child = spawnIsolated(plan, {
    stdio: reporterProtocol
      ? [stdin, "pipe", "pipe", "pipe"]
      : [stdin, "pipe", "pipe"],
    env: parentEnv
  });
  if (stdinPayload !== null && child.stdin) {

    child.stdin.on("error", () => {});
    child.stdin.end(stdinPayload);
  }
  return new Promise((resolve) => {
    const stdoutSink = createBoundedSink(outputBounds);
    const stderrSink = createBoundedSink(outputBounds);
    const reporterSink = reporterProtocol
      ? createReporterProtocolSink(DEFAULT_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES)
      : null;
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let cleanupFailed = false;
    let cleanupTimer = null;
    const terminate = (cause) => {
      if (cause === "timeout") timedOut = true;
      else cancelled = true;
      try {
        child.kill("SIGKILL");
      } catch {

      }
      if (cleanupAllowanceMs !== null && cleanupTimer === null) {
        cleanupTimer = setTimeout(() => {
          cleanupFailed = true;
          finish({ spawnError: null, code: null, signal: "SIGKILL" });
        }, cleanupAllowanceMs);
        if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();
      }
    };

    const timer = setTimeout(() => terminate("timeout"), timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    const onAbort = () => terminate("cancel");

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (cleanupTimer !== null) clearTimeout(cleanupTimer);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        ...payload,
        timedOut,
        cancelled,
        cleanupFailed,
        endedAtMs: clock(),
        stdout: stdoutSink.result(),
        stderr: stderrSink.result(),
        reporter: reporterSink?.result() ?? null
      });
    };
    if (signal !== null) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    if (child.stdout) child.stdout.on("data", (chunk) => stdoutSink.push(chunk));
    if (child.stderr) child.stderr.on("data", (chunk) => stderrSink.push(chunk));
    if (child.stdio?.[3]) child.stdio[3].on("data", (chunk) => reporterSink.push(chunk));
    child.on("error", (err) => finish({ spawnError: err?.code ?? err?.message ?? String(err), code: null, signal: null }));
    child.on("close", (code, signal) => finish({ spawnError: null, code, signal }));
  });
}
