

import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";

import { WORKTREE_REAPER_DIAGNOSTIC_CODES, fail } from "./worktree-reaper-diagnostics.mjs";

export function realpathOrLexical(p) {
  try {
    return realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    try {
      return path.join(realpathSync(parent), path.basename(p));
    } catch {
      return p;
    }
  }
}

export function pathWithin(inner, outer) {
  if (inner === outer) return true;
  const prefix = outer.endsWith(path.sep) ? outer : `${outer}${path.sep}`;
  return inner.startsWith(prefix);
}

function parseWorktreePorcelain(text) {
  const entries = [];
  let current = null;
  for (const line of String(text ?? "").split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length), branch: null, head: null };
    } else if (current && line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    }
  }
  if (current) entries.push(current);
  return entries;
}

async function gitResultOrRefusal(runGit, repo, args) {
  const result = await runGit({ repo, args });
  if (!result || result.ok !== true) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "could not verify exact slice binding", {
      args,
      stderr: result?.stderr ?? result?.error ?? result?.status ?? null
    });
  }
  return result;
}

const EXACT_REF_TRANSACTION_TIMEOUT_MS = Object.freeze({
  startup: 5_000,
  start_ack: 5_000,
  prepare_ack: 5_000,
  abort_ack: 5_000,
  final_exit: 5_000,
  terminate_grace: 1_000,
  terminate_final: 2_000
});
const EXACT_REF_TRANSACTION_CAPTURE_MAX_BYTES = 16 * 1024;

function exactRefTransactionError(message, detail = null, cause = null) {
  const error = new Error(message, cause === null ? undefined : { cause });
  if (detail !== null) error.detail = detail;
  return error;
}

function prepareExactRefTransaction({ repo, ref, expectedSha, deps = {} }) {
  const spawnChild = deps.spawnExactRefTransactionChild ?? ((command, args, options) =>
    spawn(command, args, options));
  const scheduleTimeout = deps.scheduleExactRefTransactionTimeout ??
    ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancelTimeout = deps.cancelExactRefTransactionTimeout ??
    ((handle) => clearTimeout(handle));

  return new Promise((prepareResolve, prepareReject) => {
    let child;
    try {
      child = spawnChild("git", ["-C", repo, "update-ref", "--stdin"], {
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      prepareReject(exactRefTransactionError(
        "exact slice ref transaction child could not be spawned",
        { state: "spawned", lock_release_confirmed: true },
        error
      ));
      return;
    }

    let state = "spawned";
    let stdoutBuffer = "";
    let stdoutCapture = "";
    let stdoutBytes = 0;
    let stderrCapture = "";
    let stderrBytes = 0;
    let stdoutEnded = false;
    let stdoutClosed = false;
    let stderrEnded = false;
    let stderrClosed = false;
    let stdinFinished = false;
    let stdinClosed = false;
    let stdinEndCallbackSucceeded = false;
    let stdinEndCallbackFailed = false;
    let intentionalStdinShutdown = false;
    let exitResult = null;
    let closeResult = null;
    let phaseTimer = null;
    let preparedSettled = false;
    let fatalError = null;
    let abortStarted = false;
    let abortResolve = null;
    let abortReject = null;
    const terminationErrors = [];
    let failureSettled = false;
    let failureResolve;
    const failureCompletion = new Promise((resolve) => { failureResolve = resolve; });
    let pendingFailureLockReleaseConfirmed = null;
    const protocolWrites = {
      start: {
        initiated: false,
        callback_succeeded: false,
        callback_failed: false,
        callback_error: null,
        acknowledgement_received: false,
        stdin_usable_at_confirmation: null
      },
      prepare: {
        initiated: false,
        callback_succeeded: false,
        callback_failed: false,
        callback_error: null,
        acknowledgement_received: false,
        stdin_usable_at_confirmation: null
      },
      abort: {
        initiated: false,
        callback_succeeded: false,
        callback_failed: false,
        callback_error: null,
        acknowledgement_received: false,
        stdin_usable_at_confirmation: null
      }
    };

    const writeDiagnostic = () => Object.fromEntries(
      Object.entries(protocolWrites).map(([phase, write]) => [phase, { ...write }])
    );

    const diagnostic = () => ({
      state,
      stdout: stdoutCapture,
      stderr: stderrCapture,
      stdout_residual: stdoutBuffer,
      exit: exitResult,
      close: closeResult,
      stdout_ended: stdoutEnded,
      stdout_closed: stdoutClosed,
      stderr_ended: stderrEnded,
      stderr_closed: stderrClosed,
      stdin_finished: stdinFinished,
      stdin_closed: stdinClosed,
      stdin_closed_property: child?.stdin?.closed ?? null,
      stdin_destroyed: child?.stdin?.destroyed ?? null,
      stdin_errored: child?.stdin?.errored?.message ?? child?.stdin?.errored ?? null,
      stdin_writable: child?.stdin?.writable ?? null,
      stdin_writable_ended: child?.stdin?.writableEnded ?? null,
      stdin_writable_finished: child?.stdin?.writableFinished ?? null,
      stdin_end_callback_succeeded: stdinEndCallbackSucceeded,
      stdin_end_callback_failed: stdinEndCallbackFailed,
      intentional_stdin_shutdown: intentionalStdinShutdown,
      protocol_writes: writeDiagnostic(),
      termination_errors: [...terminationErrors]
    });

    function clearPhaseTimer() {
      if (phaseTimer !== null) {
        cancelTimeout(phaseTimer);
        phaseTimer = null;
      }
    }

    function armPhaseTimer(phase, onTimeout) {
      clearPhaseTimer();
      phaseTimer = scheduleTimeout(
        () => {
          phaseTimer = null;
          onTimeout(exactRefTransactionError(
            `exact slice ref transaction timed out during ${phase}`,
            { ...diagnostic(), timeout_phase: phase }
          ));
        },
        EXACT_REF_TRANSACTION_TIMEOUT_MS[phase],
        phase
      );
    }

    function childIsLive() {
      return closeResult === null && exitResult === null &&
        child?.exitCode === null && child?.signalCode === null;
    }

    function stdinIsUsable() {
      return !stdinFinished && !stdinClosed && !intentionalStdinShutdown &&
        child?.stdin?.closed === false && child?.stdin?.destroyed === false &&
        child?.stdin?.errored === null && child?.stdin?.writable === true &&
        child?.stdin?.writableEnded === false && child?.stdin?.writableFinished === false;
    }

    function hasPendingProtocolWrite() {
      return Object.values(protocolWrites).some((write) =>
        write.initiated && !write.callback_succeeded && !write.callback_failed);
    }

    function settleFailure({ lockReleaseConfirmed, allowPendingWrites = false }) {
      if (failureSettled) return;
      if (!allowPendingWrites && hasPendingProtocolWrite()) {
        pendingFailureLockReleaseConfirmed = lockReleaseConfirmed;
        armPhaseTimer("terminate_final", () => {
          settleFailure({ lockReleaseConfirmed, allowPendingWrites: true });
        });
        return;
      }
      failureSettled = true;
      pendingFailureLockReleaseConfirmed = null;
      clearPhaseTimer();
      const failure = exactRefTransactionError(
        lockReleaseConfirmed
          ? fatalError.message
          : `${fatalError.message}; exact ref-lock release remains indeterminate`,
        { ...diagnostic(), lock_release_confirmed: lockReleaseConfirmed },
        fatalError
      );
      if (!preparedSettled) {
        preparedSettled = true;
        prepareReject(failure);
      }
      if (abortStarted && abortReject !== null) abortReject(failure);
      failureResolve(failure);
    }

    function maybeSettleFailureAfterWriteCallback() {
      if (fatalError === null || pendingFailureLockReleaseConfirmed === null ||
          hasPendingProtocolWrite()) return;
      settleFailure({ lockReleaseConfirmed: pendingFailureLockReleaseConfirmed });
    }

    function terminateAfterFailure() {
      if (closeResult !== null) {
        settleFailure({ lockReleaseConfirmed: true });
        return;
      }
      try {
        if (child.kill("SIGTERM") !== true) {
          terminationErrors.push("SIGTERM was not accepted by the transaction child");
        }
      } catch (error) {
        terminationErrors.push(`SIGTERM failed: ${error?.message ?? String(error)}`);
      }
      armPhaseTimer("terminate_grace", () => {
        if (closeResult !== null) {
          settleFailure({ lockReleaseConfirmed: true });
          return;
        }
        try {
          if (child.kill("SIGKILL") !== true) {
            terminationErrors.push("SIGKILL was not accepted by the transaction child");
          }
        } catch (error) {
          terminationErrors.push(`SIGKILL failed: ${error?.message ?? String(error)}`);
        }
        armPhaseTimer("terminate_final", () => {
          settleFailure({ lockReleaseConfirmed: closeResult !== null });
        });
      });
    }

    function beginFailure(error) {
      if (fatalError !== null) {
        terminationErrors.push(error?.message ?? String(error));
        return;
      }
      fatalError = error instanceof Error ? error : new Error(String(error));
      state = "failing";
      clearPhaseTimer();
      terminateAfterFailure();
    }

    function appendBounded(kind, chunk) {
      const text = String(chunk);
      const bytes = Buffer.byteLength(text, "utf8");
      if (kind === "stdout") {
        if (stdoutBytes + bytes > EXACT_REF_TRANSACTION_CAPTURE_MAX_BYTES) {
          beginFailure(exactRefTransactionError(
            "exact slice ref transaction stdout exceeded the bounded capture",
            diagnostic()
          ));
          return null;
        }
        stdoutBytes += bytes;
        stdoutCapture += text;
      } else {
        if (stderrBytes + bytes > EXACT_REF_TRANSACTION_CAPTURE_MAX_BYTES) {
          beginFailure(exactRefTransactionError(
            "exact slice ref transaction stderr exceeded the bounded capture",
            diagnostic()
          ));
          return null;
        }
        stderrBytes += bytes;
        stderrCapture += text;
      }
      return text;
    }

    function protocolWriteConfirmed(phase) {
      const write = protocolWrites[phase];
      return write.initiated && write.callback_succeeded && !write.callback_failed &&
        write.acknowledgement_received;
    }

    function preparedAuthorityIsCertain() {
      return fatalError === null && state === "prepared" &&
        protocolWriteConfirmed("start") && protocolWriteConfirmed("prepare") &&
        protocolWrites.start.stdin_usable_at_confirmation === true &&
        protocolWrites.prepare.stdin_usable_at_confirmation === true &&
        !protocolWrites.abort.initiated && !hasPendingProtocolWrite() &&
        stdinIsUsable() && childIsLive();
    }

    function maybeAdvanceProtocolWrite(phase) {
      if (fatalError !== null || !protocolWriteConfirmed(phase)) return;
      const stdinUsableAtConfirmation = stdinIsUsable();
      protocolWrites[phase].stdin_usable_at_confirmation = stdinUsableAtConfirmation;
      clearPhaseTimer();
      if (phase === "start") {
        state = "start_confirmed";
        if (!childIsLive() || !stdinUsableAtConfirmation) {
          beginFailure(exactRefTransactionError(
            "exact slice ref transaction confirmed start without a live, usable stdin",
            diagnostic()
          ));
          return;
        }
        writeProtocol("prepare", `verify ${ref} ${expectedSha}\nprepare\n`, "prepare_sent", "prepare_ack");
        return;
      }
      if (phase === "prepare") {
        state = "prepared";
        if (!preparedAuthorityIsCertain()) {
          beginFailure(exactRefTransactionError(
            "exact slice ref transaction confirmed preparation without certain stream/process state",
            diagnostic()
          ));
          return;
        }
        if (!preparedSettled) {
          preparedSettled = true;
          prepareResolve(Object.freeze({
            get active() {
              return preparedAuthorityIsCertain();
            },
            async abort() {
              if (abortStarted) {
                throw exactRefTransactionError(
                  "exact slice ref transaction abort was requested more than once",
                  diagnostic()
                );
              }
              abortStarted = true;
              if (!preparedAuthorityIsCertain()) {
                if (fatalError === null) {
                  beginFailure(exactRefTransactionError(
                    "exact slice ref transaction was not live with usable stdin at abort",
                    diagnostic()
                  ));
                }
                throw await failureCompletion;
              }
              const abortCompletion = new Promise((resolve, reject) => {
                abortResolve = resolve;
                abortReject = reject;
              });
              writeProtocol("abort", "abort\n", "abort_sent", "abort_ack");
              return abortCompletion;
            }
          }));
        }
        return;
      }
      if (phase === "abort") {
        state = "abort_confirmed";
        if (!childIsLive() || !stdinUsableAtConfirmation) {
          beginFailure(exactRefTransactionError(
            "exact slice ref transaction confirmed abort without a live, usable stdin",
            diagnostic()
          ));
          return;
        }
        closeStdinAfterAbortAck();
      }
    }

    function acknowledgeProtocolWrite(phase) {
      const write = protocolWrites[phase];
      if (!write.initiated || write.acknowledgement_received) {
        beginFailure(exactRefTransactionError(
          `unexpected exact slice ref transaction ${phase} acknowledgement`,
          diagnostic()
        ));
        return;
      }
      write.acknowledgement_received = true;
      maybeAdvanceProtocolWrite(phase);
    }

    function writeProtocol(phase, data, nextState, timeoutPhase) {
      if (!childIsLive() || !stdinIsUsable()) {
        beginFailure(exactRefTransactionError(
          "exact slice ref transaction child/stdin was not usable before a protocol write",
          diagnostic()
        ));
        return;
      }
      const write = protocolWrites[phase];
      if (write.initiated) {
        beginFailure(exactRefTransactionError(
          `exact slice ref transaction ${phase} write was initiated more than once`,
          diagnostic()
        ));
        return;
      }
      write.initiated = true;
      state = nextState;
      armPhaseTimer(timeoutPhase, beginFailure);
      try {
        child.stdin.write(data, (error) => {
          if (error) {
            write.callback_failed = true;
            write.callback_error = error?.message ?? String(error);
            beginFailure(exactRefTransactionError(
              `exact slice ref transaction ${phase} stdin write failed`,
              diagnostic(),
              error
            ));
            maybeSettleFailureAfterWriteCallback();
            return;
          }
          write.callback_succeeded = true;
          maybeAdvanceProtocolWrite(phase);
          maybeSettleFailureAfterWriteCallback();
        });
      } catch (error) {
        write.callback_failed = true;
        write.callback_error = error?.message ?? String(error);
        beginFailure(exactRefTransactionError(
          `exact slice ref transaction ${phase} stdin write threw`,
          diagnostic(),
          error
        ));
      }
    }

    function maybeFinalizeAbort() {
      if (fatalError !== null || state !== "finalizing" ||
          !protocolWriteConfirmed("abort") || !intentionalStdinShutdown ||
          !stdinEndCallbackSucceeded || stdinEndCallbackFailed ||
          !stdinFinished || !stdinClosed ||
          exitResult === null || closeResult === null ||
          !stdoutEnded || !stdoutClosed || !stderrEnded || !stderrClosed) {
        return;
      }
      if (stdoutBuffer.length !== 0 || stderrCapture.length !== 0 ||
          exitResult.code !== 0 || exitResult.signal !== null ||
          closeResult.code !== exitResult.code || closeResult.signal !== exitResult.signal ||
          child.stdin.closed !== true || child.stdin.destroyed !== true ||
          child.stdin.errored !== null || child.stdin.writable !== false ||
          child.stdin.writableEnded !== true || child.stdin.writableFinished !== true) {
        beginFailure(exactRefTransactionError(
          "exact slice ref transaction did not terminate cleanly after abort",
          diagnostic()
        ));
        return;
      }
      clearPhaseTimer();
      state = "closed";
      abortResolve();
    }

    function closeStdinAfterAbortAck() {
      intentionalStdinShutdown = true;
      state = "finalizing";
      armPhaseTimer("final_exit", beginFailure);
      try {
        child.stdin.end((error) => {
          if (error) {
            stdinEndCallbackFailed = true;
            beginFailure(exactRefTransactionError(
              "exact slice ref transaction stdin close failed",
              diagnostic(),
              error
            ));
            return;
          }
          stdinEndCallbackSucceeded = true;
          maybeFinalizeAbort();
        });
      } catch (error) {
        beginFailure(exactRefTransactionError(
          "exact slice ref transaction stdin close threw",
          diagnostic(),
          error
        ));
      }
    }

    function handleStdoutLine(line) {
      if (fatalError !== null) return;
      if (state === "start_sent" && line === "start: ok") {
        acknowledgeProtocolWrite("start");
        return;
      }
      if (state === "prepare_sent" && line === "prepare: ok") {
        acknowledgeProtocolWrite("prepare");
        return;
      }
      if (state === "abort_sent" && line === "abort: ok") {
        acknowledgeProtocolWrite("abort");
        return;
      }
      beginFailure(exactRefTransactionError(
        `unexpected exact slice ref transaction stdout line ${JSON.stringify(line)}`,
        diagnostic()
      ));
    }

    if (!child || typeof child.on !== "function" || typeof child.once !== "function" ||
        !child.stdin || !child.stdout || !child.stderr ||
        typeof child.stdin.write !== "function" || typeof child.stdin.end !== "function" ||
        typeof child.stdin.once !== "function" ||
        typeof child.stdin.closed !== "boolean" || typeof child.stdin.destroyed !== "boolean" ||
        child.stdin.errored === undefined || typeof child.stdin.writable !== "boolean" ||
        typeof child.stdin.writableEnded !== "boolean" ||
        typeof child.stdin.writableFinished !== "boolean" ||
        typeof child.stdout.setEncoding !== "function" ||
        typeof child.stderr.setEncoding !== "function" || typeof child.kill !== "function") {
      const contractTerminationErrors = [];
      if (typeof child?.kill === "function") {
        for (const signal of ["SIGTERM", "SIGKILL"]) {
          try {
            if (child.kill(signal) !== true) {
              contractTerminationErrors.push(`${signal} was not accepted by the malformed transaction child`);
            }
          } catch (error) {
            contractTerminationErrors.push(`${signal} failed: ${error?.message ?? String(error)}`);
          }
        }
      } else {
        contractTerminationErrors.push("malformed transaction child exposed no termination method");
      }
      prepareReject(exactRefTransactionError(
        "exact slice ref transaction child did not expose the required stdio/process contract",
        { state, lock_release_confirmed: false, termination_errors: contractTerminationErrors }
      ));
      return;
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (fatalError !== null) return;
      const text = appendBounded("stdout", chunk);
      if (text === null || fatalError !== null) return;
      stdoutBuffer += text;
      let newline;
      while (fatalError === null && (newline = stdoutBuffer.indexOf("\n")) !== -1) {
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        handleStdoutLine(line);
      }
    });
    child.stdout.once("error", (error) => {
      beginFailure(exactRefTransactionError(
        "exact slice ref transaction stdout stream failed",
        diagnostic(),
        error
      ));
    });
    child.stdout.once("end", () => {
      stdoutEnded = true;
      if (fatalError === null && stdoutBuffer.length !== 0) {
        beginFailure(exactRefTransactionError(
          "exact slice ref transaction stdout ended with an unterminated response",
          diagnostic()
        ));
      } else if (fatalError === null && state !== "finalizing") {
        beginFailure(exactRefTransactionError(
          "exact slice ref transaction stdout ended before abort completion",
          diagnostic()
        ));
      }
      maybeFinalizeAbort();
    });
    child.stdout.once("close", () => {
      stdoutClosed = true;
      if (fatalError === null && !stdoutEnded) {
        beginFailure(exactRefTransactionError(
          "exact slice ref transaction stdout closed before clean EOF",
          diagnostic()
        ));
      }
      maybeFinalizeAbort();
    });
    child.stderr.on("data", (chunk) => {
      if (fatalError !== null) return;
      const text = appendBounded("stderr", chunk);
      if (text !== null && fatalError === null && text.length > 0) {
        beginFailure(exactRefTransactionError(
          "exact slice ref transaction emitted unexpected stderr",
          diagnostic()
        ));
      }
    });
    child.stderr.once("error", (error) => {
      beginFailure(exactRefTransactionError(
        "exact slice ref transaction stderr stream failed",
        diagnostic(),
        error
      ));
    });
    child.stderr.once("end", () => {
      stderrEnded = true;
      if (fatalError === null && state !== "finalizing") {
        beginFailure(exactRefTransactionError(
          "exact slice ref transaction stderr ended before abort completion",
          diagnostic()
        ));
      }
      maybeFinalizeAbort();
    });
    child.stderr.once("close", () => {
      stderrClosed = true;
      if (fatalError === null && !stderrEnded) {
        beginFailure(exactRefTransactionError(
          "exact slice ref transaction stderr closed before clean EOF",
          diagnostic()
        ));
      }
      maybeFinalizeAbort();
    });
    child.stdin.once("error", (error) => {
      beginFailure(exactRefTransactionError(
        "exact slice ref transaction stdin stream failed",
        diagnostic(),
        error
      ));
    });
    child.stdin.once("finish", () => {
      stdinFinished = true;
      if (fatalError === null && (!intentionalStdinShutdown || state !== "finalizing")) {
        beginFailure(exactRefTransactionError(
          "exact slice ref transaction stdin finished before intentional post-abort shutdown",
          diagnostic()
        ));
      }
      maybeFinalizeAbort();
    });
    child.stdin.once("close", () => {
      stdinClosed = true;
      if (fatalError === null && (!intentionalStdinShutdown || state !== "finalizing")) {
        beginFailure(exactRefTransactionError(
          "exact slice ref transaction stdin closed before intentional post-abort shutdown",
          diagnostic()
        ));
      }
      maybeFinalizeAbort();
    });
    child.once("error", (error) => {
      beginFailure(exactRefTransactionError(
        "exact slice ref transaction child failed",
        diagnostic(),
        error
      ));
    });
    child.once("spawn", () => {
      if (fatalError !== null) return;
      clearPhaseTimer();
      state = "spawned";
      writeProtocol("start", "start\n", "start_sent", "start_ack");
    });
    child.once("exit", (code, signal) => {
      exitResult = { code, signal };
      if (fatalError === null &&
          (state !== "finalizing" || code !== 0 || signal !== null)) {
        beginFailure(exactRefTransactionError(
          "exact slice ref transaction child exited before clean abort completion",
          diagnostic()
        ));
      }
      maybeFinalizeAbort();
    });
    child.once("close", (code, signal) => {
      closeResult = { code, signal };
      if (fatalError !== null) {
        if (exitResult === null || exitResult.code !== code || exitResult.signal !== signal) {
          terminationErrors.push("transaction child close did not match a prior exit event");
        }
        settleFailure({ lockReleaseConfirmed: true });
        return;
      }
      if (exitResult === null || exitResult.code !== code || exitResult.signal !== signal) {
        beginFailure(exactRefTransactionError(
          "exact slice ref transaction child close did not match exit",
          diagnostic()
        ));
        return;
      }
      maybeFinalizeAbort();
    });

    state = "starting";
    armPhaseTimer("startup", beginFailure);
  });
}

export async function withPreparedExactRefLock({ repo, ref, expectedSha, deps = {} }, operation) {
  let transaction;
  try {
    transaction = await prepareExactRefTransaction({ repo, ref, expectedSha, deps });
  } catch (error) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING,
      "could not prepare the exact slice ref transaction before cleanup",
      { ref, expected_sha: expectedSha },
      error
    );
  }
  if (transaction.active !== true) {
    let releaseError = null;
    try {
      await transaction.abort();
    } catch (error) {
      releaseError = error;
    }
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING,
      "exact slice ref transaction lock state is uncertain before cleanup",
      {
        ref,
        expected_sha: expectedSha,
        transaction_release_error: releaseError?.message ?? null
      },
      releaseError
    );
  }

  let value;
  let operationError = null;
  try {
    value = await operation();
  } catch (error) {
    operationError = error;
  }

  let abortError = null;
  try {
    await transaction.abort();
  } catch (error) {
    abortError = error;
  }
  if (operationError !== null) {
    if (abortError !== null) {
      fail(
        WORKTREE_REAPER_DIAGNOSTIC_CODES.REAP_FAILED,
        "exact-slice cleanup failed and the ref transaction could not be released safely",
        {
          ref,
          expected_sha: expectedSha,
          cleanup_error: operationError?.message ?? String(operationError),
          transaction_error: abortError?.message ?? String(abortError)
        },
        operationError
      );
    }
    throw operationError;
  }
  if (abortError !== null) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.REAP_FAILED,
      "exact slice ref transaction could not be released safely",
      { ref, expected_sha: expectedSha },
      abortError
    );
  }
  return value;
}

export async function observeExactWorktree({ runGit, repo, worktreePath, branch }) {
  const worktreeReal = realpathOrLexical(worktreePath);
  const listed = await gitResultOrRefusal(runGit, repo, ["worktree", "list", "--porcelain"]);
  const entry = parseWorktreePorcelain(listed.stdout).find((candidate) => realpathOrLexical(candidate.path) === worktreeReal);
  const branchResult = await runGit({ repo, args: ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`] });
  const pathPresent = existsSync(worktreePath);
  const branchPresent = Boolean(branchResult && branchResult.ok === true);
  const branchTip = branchPresent ? branchResult.stdout.trim() : null;
  return { entry, pathPresent, branchPresent, branchTip };
}

export async function readExactWorktreeStatus({ runGit, worktreePath }) {
  const status = await gitResultOrRefusal(runGit, worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"]);
  return status.stdout;
}

export async function removeExactWorktreePreservingRef({
  runGit,
  repo,
  worktreePath,
  branch,
  expectedTip,
  force,
  audit,
  deps = {}
}) {
  await withPreparedExactRefLock({
    repo,
    ref: `refs/heads/${branch}`,
    expectedSha: expectedTip,
    deps
  }, async () => {
    const removeArgs = force === true
      ? ["worktree", "remove", "--force", worktreePath]
      : ["worktree", "remove", worktreePath];
    const remove = await runGit({ repo, args: removeArgs });
    const preserved = remove?.ok === true
      ? await runGit({ repo, args: ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`] })
      : null;
    const preservedTip = preserved?.ok === true ? preserved.stdout.trim() : null;
    if (!remove || remove.ok !== true || preservedTip !== expectedTip) {
      fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.REAP_FAILED, "exact-slice cleanup failed", {
        worktree_remove: remove?.stderr ?? remove?.error ?? remove?.status ?? null,
        branch_preservation: preserved?.stderr ?? preserved?.error ?? preserved?.status ?? preservedTip,
        audit
      });
    }
  });
}
