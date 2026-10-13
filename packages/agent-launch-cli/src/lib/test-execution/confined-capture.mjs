

import { NODE_TEST_PROOF_REPORTER_PROTOCOL_CAP_BYTES } from
  "../workspace-agent-test-proof-node-observation.mjs";
import { processGroupExists, signalProcessGroup, terminateProcessGroup } from
  "../../../../wiki-core/src/lib/process-group.mjs";

export const DEFAULT_VALIDATION_TIMEOUT_MS = 30000;

export const DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS = 300000;

export const TEST_PROOF_LIVE_CLEANUP_ALLOWANCE_MS = 5000;
export const TEST_PROOF_PROCESS_GROUP_TERM_GRACE_MS = 500;
export const TEST_PROOF_PROCESS_GROUP_KILL_GRACE_MS = 500;

export async function settleOwnedProcessGroup(pid, operations = {
  processGroupExists, terminateProcessGroup
}) {
  if (process.platform === "win32") {
    return { cleanupFailed: true, cleanupError: "process_group_unsupported",
      cleanupScope: "owned_process_group", ownedProcessGroupSettled: false };
  }
  try {
    if (operations.processGroupExists(pid)) {
      await operations.terminateProcessGroup(pid, { termGraceMs: TEST_PROOF_PROCESS_GROUP_TERM_GRACE_MS,
        killGraceMs: TEST_PROOF_PROCESS_GROUP_KILL_GRACE_MS });
    }
    return { cleanupFailed: false, cleanupError: null,
      cleanupScope: "owned_process_group", ownedProcessGroupSettled: true };
  } catch (error) {
    return { cleanupFailed: true, cleanupError: error?.code ?? "process_group_settlement_failed",
      cleanupScope: "owned_process_group", ownedProcessGroupSettled: false };
  }
}

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

export const NATIVE_REPORT_LINE_CAP_BYTES = 1024 * 1024;

export function createNativeReportObserver(adapter, { lineCapBytes = NATIVE_REPORT_LINE_CAP_BYTES } = {}) {
  let pending = [];
  let pendingBytes = 0;
  let oversized = false;
  let lost = false;
  let failed = false;
  const deliver = (bytes) => {
    if (failed) return;
    try {
      adapter.line(bytes.toString("utf8"));
    } catch {
      failed = true;
    }
  };
  const frame = (chunk) => {
    let start = 0;
    for (let index = chunk.indexOf(0x0a); index >= 0; index = chunk.indexOf(0x0a, start)) {
      const piece = chunk.subarray(start, index);
      if (!oversized && pendingBytes + piece.length <= lineCapBytes) {
        deliver(pending.length === 0 ? piece : Buffer.concat([...pending, piece]));
      } else lost = true;
      pending = [];
      pendingBytes = 0;
      oversized = false;
      start = index + 1;
    }
    const rest = chunk.subarray(start);
    if (rest.length === 0 || oversized) return;
    if (pendingBytes + rest.length > lineCapBytes) {
      oversized = true;
      pending = [];
      pendingBytes = 0;
      return;
    }
    pending.push(Buffer.from(rest));
    pendingBytes += rest.length;
  };
  return {
    stream: adapter.stream ?? "stdout",
    push(chunk) {
      frame(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8"));
    },
    finish() {
      if (oversized) lost = true;
      else if (pendingBytes > 0) deliver(Buffer.concat(pending));
      pending = [];
      let facts = null;
      if (!failed) {
        try { facts = adapter.finish(); } catch { failed = true; }
      }
      return Object.freeze({ ...(facts ?? {}), unreadable: lost || failed });
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
  stdinPayload = null,
  nativeReport = null,
  ownedProcessGroup = false,
  processGroupOperations = null
}) {
  const stdin = stdinPayload === null ? "ignore" : "pipe";
  const child = spawnIsolated(plan, {
    stdio: reporterProtocol
      ? [stdin, "pipe", "pipe", "pipe"]
      : [stdin, "pipe", "pipe"],
    env: parentEnv,
    ...(ownedProcessGroup ? { detached: true } : {})
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
    let cleanupError = null;
    let cleanupScope = ownedProcessGroup ? "owned_process_group" : "confined_process_tree";
    let ownedProcessGroupSettled = null;
    let cleanupTimer = null;
    let groupSettlement = null;

    let terminationRequest = null;
    let observedExit = null;
    const observeExit = (code, exitSignal) => {
      if (settled || observedExit !== null) return;
      observedExit = { code: typeof code === "number" ? code : null, signal: exitSignal ?? null };
    };
    const settleGroup = () => {
      if (groupSettlement === null) {
        groupSettlement = Number.isInteger(child.pid)
          ? settleOwnedProcessGroup(child.pid, processGroupOperations ?? undefined)
          : Promise.resolve({ cleanupFailed: true, cleanupError: "process_group_pid_unavailable",
            cleanupScope: "owned_process_group", ownedProcessGroupSettled: false });
      }
      return groupSettlement;
    };
    const terminate = (cause) => {
      if (cause === "timeout") timedOut = true;
      else cancelled = true;
      const groupRequest = ownedProcessGroup && Number.isInteger(child.pid);
      let delivered = null;
      let requestError = null;
      try {
        delivered = (groupRequest ? signalProcessGroup(child.pid, "SIGKILL") : child.kill("SIGKILL")) === true;
      } catch (error) {
        requestError = error?.code ?? "process_termination_failed";
        if (error?.code !== "ESRCH") cleanupError = requestError;
      }
      if (terminationRequest === null) {
        terminationRequest = Object.freeze({ signal: "SIGKILL",
          scope: groupRequest ? "owned_process_group" : "child_process", delivered, error: requestError });
      }
      if (ownedProcessGroup) {
        void settleGroup().then((settlement) => finish({
          spawnError: null, code: null, signal: "SIGKILL", ...settlement
        }));
      } else if (cleanupAllowanceMs !== null && cleanupTimer === null) {
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

    const finish = async (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (cleanupTimer !== null) clearTimeout(cleanupTimer);
      signal?.removeEventListener("abort", onAbort);
      if (ownedProcessGroup && Number.isInteger(child.pid)) {
        const settlement = payload.cleanupScope === "owned_process_group"
          ? payload : await settleGroup();
        cleanupFailed = cleanupFailed || settlement.cleanupFailed;
        cleanupError = cleanupError ?? settlement.cleanupError;
        cleanupScope = settlement.cleanupScope;
        ownedProcessGroupSettled = settlement.ownedProcessGroupSettled;
      }
      resolve({
        ...payload,
        termination: terminationRequest === null ? null : Object.freeze({ requested: terminationRequest,
          process: Object.freeze(observedExit === null ? { exited: false, exit_code: null, signal: null }
            : { exited: true, exit_code: observedExit.code, signal: observedExit.signal }) }),
        timedOut,
        cancelled,
        cleanupFailed,
        cleanupError,
        cleanupScope,
        ownedProcessGroupSettled,
        endedAtMs: clock(),
        stdout: stdoutSink.result(),
        stderr: stderrSink.result(),
        reporter: reporterSink?.result() ?? null,
        native_report: nativeReport?.finish() ?? null
      });
    };
    if (signal !== null) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    if (child.stdout) child.stdout.on("data", (chunk) => {
      if (nativeReport?.stream === "stdout") nativeReport.push(chunk);
      stdoutSink.push(chunk);
    });
    if (child.stderr) child.stderr.on("data", (chunk) => {
      if (nativeReport?.stream === "stderr") nativeReport.push(chunk);
      stderrSink.push(chunk);
    });
    if (child.stdio?.[3]) child.stdio[3].on("data", (chunk) => reporterSink.push(chunk));
    child.on("error", (err) => finish({ spawnError: err?.code ?? err?.message ?? String(err), code: null, signal: null }));
    child.on("exit", observeExit);
    child.on("close", (code, signal) => {
      observeExit(code, signal);
      return finish({ spawnError: null, code, signal });
    });
  });
}

export const WORKSPACE_AGENT_VALIDATION_DISPOSITIONS = Object.freeze({
  PASSED: "passed",
  FAILED: "failed",
  NOT_RUN: "not_run",
  UNCONFIRMED: "unconfirmed"
});

export function interruptedBeforeSpawn(baseEvidence, interruption, startedAtMs, endedAtMs) {
  return Object.freeze({
    ...baseEvidence,
    ran: false,
    skipped: false,
    disposition: WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.NOT_RUN,
    ok: false,
    exit_code: null,
    signal: null,
    timed_out: interruption === "timed_out",
    cancelled: interruption === "cancelled",
    cleanup_failed: false,
    blocker_code: interruption === "timed_out"
      ? "test_proof_execution_timed_out" : "test_proof_execution_cancelled",
    started_at_ms: startedAtMs,
    ended_at_ms: endedAtMs,
    duration_ms: endedAtMs - startedAtMs
  });
}

const isTerminationCapture = (termination) => termination !== null && typeof termination === "object" &&
  typeof termination.requested?.signal === "string" && typeof termination.process?.exited === "boolean";

export function settleConfinedCapture({ baseEvidence, capture, startedAtMs, outputBounds,
  executionBudget = null, proofObservation = null }) {
  const exitCode = typeof capture.code === "number" ? capture.code : null;

  const ran = capture.spawnError === null;
  const budgetInterruption = capture.cancelled || (capture.timedOut && executionBudget !== null)
    ? executionBudget?.interruption() ?? null : null;
  const cancelled = capture.cancelled && budgetInterruption === "cancelled";
  const timedOut = capture.timedOut || (capture.cancelled && budgetInterruption !== "cancelled");
  const interrupted = timedOut || cancelled;
  const reporterProtocolOverflow = capture.reporter?.protocol_overflow === true;
  const testProofObservation = proofObservation !== null && ran &&
      (reporterProtocolOverflow || !interrupted)
    ? proofObservation({ protocolText: capture.reporter.text, exitCode, reporterProtocolOverflow })
    : null;

  const ok = ran && !interrupted && exitCode === 0;
  let disposition;
  if (!ran) {
    disposition = WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.NOT_RUN;
  } else if (ok) {
    disposition = WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.PASSED;
  } else {
    disposition = WORKSPACE_AGENT_VALIDATION_DISPOSITIONS.FAILED;
  }
  const blockerCode = executionBudget === null ? null
    : capture.cleanupFailed ? "test_proof_execution_cleanup_failed"
      : cancelled ? "test_proof_execution_cancelled"
        : timedOut ? "test_proof_execution_timed_out" : null;

  return Object.freeze({
    ...baseEvidence,
    ran,
    skipped: false,
    disposition,
    ok,
    exit_code: exitCode,
    signal: capture.signal ?? null,
    timed_out: timedOut,
    ...(executionBudget === null ? {} : { cancelled }),

    cleanup_failed: capture.cleanupFailed === true,
    cleanup_scope: capture.cleanupScope ?? null,
    cleanup_error: capture.cleanupError ?? null,
    ...(capture.ownedProcessGroupSettled === null || capture.ownedProcessGroupSettled === undefined
      ? {} : { owned_process_group_settled: capture.ownedProcessGroupSettled }),

    ...(interrupted && isTerminationCapture(capture.termination) ? { termination: Object.freeze({
      cause: cancelled ? "cancelled" : "timed_out",
      requested: capture.termination.requested,
      process: capture.termination.process,
      ...(capture.runnerOutcome === undefined ? {} : { runner_outcome: capture.runnerOutcome })
    }) } : {}),
    spawn_error: capture.spawnError,
    ...(proofObservation !== null ? {
      test_proof_observation: testProofObservation,
      ...(blockerCode === null ? {} : { blocker_code: blockerCode })
    } : {}),
    output_truncated: capture.stdout.truncated || capture.stderr.truncated ||
      capture.reporter?.truncated === true,
    output_elided_bytes: capture.stdout.elided_bytes + capture.stderr.elided_bytes +
      (capture.reporter?.elided_bytes ?? 0),
    output_bounds: Object.freeze({
      head_cap_bytes: outputBounds.headCapBytes,
      tail_cap_bytes: outputBounds.tailCapBytes,
      retains: "head_and_tail"
    }),

    stdout: capture.stdout.text,
    stderr: capture.stderr.text,
    started_at_ms: startedAtMs,
    ended_at_ms: capture.endedAtMs,
    duration_ms: capture.endedAtMs - startedAtMs
  });
}
