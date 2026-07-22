

import path from "node:path";
import { spawn } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync
} from "node:fs";

import { defaultRunGit, resolveWorktreeBinding } from "./worktree-substrate.mjs";
import { confirmedDead } from "./worktree-lease.mjs";
import { digestTrustedExactReviewEvidence } from "./workspace-agent-dispatch-run-receipt.mjs";
import { WORKTREE_REAPER_DIAGNOSTIC_CODES, WorktreeReaperError, assertAbsolutePath, fail } from "./worktree-reaper-diagnostics.mjs";

import { assertWkTerminalDisposition, defaultResolveWkTerminalDispositionProof } from "./worktree-reaper-wk-terminal-proof.mjs";

export { WORKTREE_REAPER_DIAGNOSTIC_CODES, WorktreeReaperError, defaultResolveWkTerminalDispositionProof };
export {
  WK_TERMINAL_DISPOSITION_PROOF_FIELDS,
  WK_TERMINAL_DISPOSITION_PROOF_INPUT_FIELDS,
  WK_TERMINAL_DISPOSITION_PROOF_SCHEMA_VERSION,
  WK_TERMINAL_DISPOSITION_VALUES,
  WK_TERMINAL_PROOF_DIAGNOSTIC_CODES,
  buildWkTerminalDispositionProof,
  computeWkTerminalDispositionProofDigest,
  computeWkTerminalDispositionReceiptDigest,
  validateWkTerminalDispositionProof,
  wkTerminalDispositionProofPath
} from "./worktree-reaper-wk-terminal-proof.mjs";

export const WORKTREE_REAPER_SCHEMA_VERSION = "worktree-reaper-audit.v1";

export const WORKTREE_REAPER_REASONS = Object.freeze(["unit-done", "cancelled", "operator-directed"]);
export const RETAINED_SLICE_CLEANUP_DISPOSITIONS = Object.freeze([
  "successful-integration",
  "accepted-review",
  "orchestrator-cancelled",
  "orchestrator-revert"
]);

const PER_WK_BRANCH_RE = /^wk\/IN-\d{4}\/WK-\d{4}$/;
const PER_WK_WORKTREE_DIR_RE = /^wk-IN-\d{4}-WK-\d{4}$/;
const OID_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;
const SLICE_BRANCH_RE = /^slice\/IN-\d{4}\/WK-\d{4}\/SLICE-\d{3}$/;
const SLICE_WORKTREE_DIR_RE = /^slice-IN-\d{4}-WK-\d{4}-SLICE-\d{3}$/;

function assertReason(reason) {
  if (typeof reason !== "string" || !WORKTREE_REAPER_REASONS.includes(reason)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.INVALID_REASON,
      `reason must be one of ${WORKTREE_REAPER_REASONS.join("|")}, got: ${JSON.stringify(reason)}`
    );
  }
  return reason;
}

function realpathOrLexical(p) {
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

function pathWithin(inner, outer) {
  if (inner === outer) return true;
  const prefix = outer.endsWith(path.sep) ? outer : `${outer}${path.sep}`;
  return inner.startsWith(prefix);
}

function assertRemovableTarget(mainRepo, branch, worktreePath) {
  if (typeof branch !== "string" || !PER_WK_BRANCH_RE.test(branch)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.PROTECTED_REF,
      `refusing to remove a non per-WK branch: ${JSON.stringify(branch)} ` +
        "(only ephemeral wk/IN-XXXX/WK-YYYY refs are removable; integration/IN-*, " +
        "refs/agent-launch/lease/*, and main are protected)",
      { branch }
    );
  }
  if (typeof worktreePath !== "string" || worktreePath.length === 0 || !path.isAbsolute(worktreePath)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.BINDING_INVALID,
      `binding worktree_path must be a non-empty absolute path, got: ${JSON.stringify(worktreePath)}`,
      { worktreePath }
    );
  }
  const base = path.basename(worktreePath);
  if (!PER_WK_WORKTREE_DIR_RE.test(base)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.PROTECTED_WORKTREE,
      `refusing to remove a non per-WK worktree dir: ${JSON.stringify(base)} ` +
        "(only ephemeral wk-IN-XXXX-WK-YYYY dirs are removable; the integration-IN-* " +
        "worktree persists, §8.3)",
      { worktreePath, base }
    );
  }

  const repoReal = realpathOrLexical(mainRepo);
  const worktreeReal = realpathOrLexical(worktreePath);
  if (pathWithin(worktreeReal, repoReal) || pathWithin(repoReal, worktreeReal)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.PROTECTED_WORKTREE,
      `refusing to remove a worktree inside/at the main repo working tree: ${worktreeReal} vs ${repoReal}`,
      { worktreeReal, repoReal }
    );
  }
}

export function worktreeReaperAuditDir(mainRepo) {
  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  return path.join(repo, ".agent-launch", "worktree-reaper-audit");
}

export function defaultWriteAudit({ auditDir, line }) {
  mkdirSync(auditDir, { recursive: true });
  const filePath = path.join(auditDir, "reaper-audit.jsonl");
  let fd;
  try {
    fd = openSync(filePath, fsConstants.O_CREAT | fsConstants.O_WRONLY | fsConstants.O_APPEND, 0o600);
  } catch (err) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.AUDIT_WRITE_FAILED,
      `failed to open reaper audit sink: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
  try {
    writeSync(fd, line);
  } catch (err) {
    try { closeSync(fd); } catch {   }
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.AUDIT_WRITE_FAILED,
      `failed to append to reaper audit sink: ${filePath}`,
      { errno: err?.code ?? null },
      err
    );
  }
  try { closeSync(fd); } catch {   }
  return filePath;
}

function captureBranchTip(runGit, mainRepo, branch) {
  const res = runGit({ repo: mainRepo, args: ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`] });
  if (!res || res.ok !== true) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.AUDIT_CAPTURE_FAILED,
      `could not capture pre-delete tip of ${branch} (refs/heads/${branch} does not resolve to a commit)`,
      { branch, stderr: res?.stderr ?? res?.error ?? null, status: res?.status ?? null }
    );
  }
  const sha = (res.stdout ?? "").trim();
  if (!OID_RE.test(sha)) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.AUDIT_CAPTURE_FAILED,
      `pre-delete tip of ${branch} is not a 40-hex object id, got: ${JSON.stringify(sha)}`,
      { branch }
    );
  }
  return sha;
}

function branchExists(runGit, mainRepo, branch) {
  const res = runGit({ repo: mainRepo, args: ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`] });
  return Boolean(res && res.ok === true);
}

function removeWorktreeAndBranch(runGit, mainRepo, worktreePath, branch, auditRecord) {
  const failures = [];
  const remove = runGit({ repo: mainRepo, args: ["worktree", "remove", "--force", worktreePath] });
  if (!remove || remove.ok !== true) {
    failures.push({ step: "worktree remove --force", detail: remove?.stderr ?? remove?.error ?? remove?.status ?? null });
  }
  const prune = runGit({ repo: mainRepo, args: ["worktree", "prune"] });
  if (!prune || prune.ok !== true) {
    failures.push({ step: "worktree prune", detail: prune?.stderr ?? prune?.error ?? prune?.status ?? null });
  }

  if (branchExists(runGit, mainRepo, branch)) {
    const del = runGit({ repo: mainRepo, args: ["branch", "-D", branch] });
    if (!del || del.ok !== true) {
      failures.push({ step: "branch -D", detail: del?.stderr ?? del?.error ?? del?.status ?? null });
    }
  }
  if (failures.length > 0) {
    fail(
      WORKTREE_REAPER_DIAGNOSTIC_CODES.REAP_FAILED,
      "worktree/branch removal failed to fully complete; half-state remains and must be resolved by the operator " +
        "(the pre-delete tip is in the audit record and reflog-recoverable)",
      { worktreePath, branch, removalFailures: failures, audit: auditRecord }
    );
  }
}

export function releaseWorktree({
  mainRepo,
  launchRef,
  runId,
  retryId = 0,
  reason,
  identity = null,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const writeAudit = deps.writeAudit ?? defaultWriteAudit;
  const resolveBinding = deps.resolveBinding ?? resolveWorktreeBinding;
  const isConfirmedDead = deps.confirmedDead ?? confirmedDead;
  const resolveProof = deps.resolveWkTerminalDispositionProof ?? defaultResolveWkTerminalDispositionProof;
  const clock = deps.clock ?? (() => new Date().toISOString());

  const repo = assertAbsolutePath(mainRepo, "mainRepo");
  assertReason(reason);

  const binding = resolveBinding({ mainRepo: repo, launchRef, runId, retryId });
  if (!binding || typeof binding !== "object") {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.BINDING_INVALID, "resolved binding is not an object");
  }
  const outputBranch = binding.output_branch;
  const worktreePath = binding.worktree_path;

  assertRemovableTarget(repo, outputBranch, worktreePath);

  const dispositionProof = assertWkTerminalDisposition({
    mainRepo: repo,
    binding,
    runGit,
    resolveProof
  });

  if (identity !== null) {
    if (!isConfirmedDead(identity, deps.livenessDeps)) {
      fail(
        WORKTREE_REAPER_DIAGNOSTIC_CODES.ALIVE_OR_INDETERMINATE,
        "refusing removal: supplied identity is not confirmed dead (alive or indeterminate); " +
          "reaping is gated on a confirmed death when an identity is provided (fail closed)",
        { output_branch: outputBranch }
      );
    }
  }

  const tipSha = captureBranchTip(runGit, repo, outputBranch);
  const auditRecord = Object.freeze({
    schema_version: WORKTREE_REAPER_SCHEMA_VERSION,
    reason,
    initiative: binding.initiative ?? null,
    subject: binding.subject ?? null,
    wk_id: binding.wk_id ?? null,
    output_branch: outputBranch,
    worktree_path: worktreePath,
    tip_sha: tipSha,
    launch_ref: launchRef,
    run_id: runId,
    retry_id: retryId,
    liveness_checked: identity !== null,

    wk_terminal_disposition: dispositionProof,
    reaped_at: clock()
  });
  const auditDir = worktreeReaperAuditDir(repo);
  writeAudit({ auditDir, record: auditRecord, line: `${JSON.stringify(auditRecord)}\n` });

  removeWorktreeAndBranch(runGit, repo, worktreePath, outputBranch, auditRecord);

  return Object.freeze({
    reaped: true,
    ...auditRecord,
    audit_dir: auditDir
  });
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

function exactSliceAuditMatches({
  record,
  binding,
  disposition,
  launchRef,
  runId,
  retryId,
  expectedTip,
  worktreeIdentityDigest
}) {
  return record.schema_version === WORKTREE_REAPER_SCHEMA_VERSION &&
    record.unit_address === binding.unit_address &&
    record.output_branch === binding.output_branch &&
    record.worktree_path === binding.worktree_path &&
    record.disposition === disposition &&
    record.launch_ref === launchRef &&
    record.run_id === runId &&
    record.retry_id === retryId &&
    record.worktree_identity_digest === worktreeIdentityDigest &&
    record.tip_sha === expectedTip &&
    (disposition !== "successful-integration" || record.integrated_sha === expectedTip);
}

function priorExactSliceAudit(
  mainRepo,
  binding,
  disposition,
  launchRef,
  runId,
  retryId,
  expectedTip,
  worktreeIdentityDigest
) {
  const file = path.join(worktreeReaperAuditDir(mainRepo), "reaper-audit.jsonl");
  let lines;
  try { lines = readFileSync(file, "utf8").trim().split("\n"); } catch { return null; }
  for (const line of lines.reverse()) {
    try {
      const record = JSON.parse(line);
      if (record.completed === true && exactSliceAuditMatches({
        record,
        binding,
        disposition,
        launchRef,
        runId,
        retryId,
        expectedTip,
        worktreeIdentityDigest
      })) return record;
    } catch {   }
  }
  return null;
}

function priorExactSliceAttempt(
  mainRepo,
  binding,
  disposition,
  launchRef,
  runId,
  retryId,
  expectedTip,
  worktreeIdentityDigest
) {
  const file = path.join(worktreeReaperAuditDir(mainRepo), "reaper-audit.jsonl");
  let lines;
  try { lines = readFileSync(file, "utf8").trim().split("\n"); } catch { return null; }
  for (const line of lines.reverse()) {
    try {
      const record = JSON.parse(line);
      if (record.completed === false && exactSliceAuditMatches({
        record,
        binding,
        disposition,
        launchRef,
        runId,
        retryId,
        expectedTip,
        worktreeIdentityDigest
      })) return record;
    } catch {   }
  }
  return null;
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

async function withPreparedExactRefLock({ repo, ref, expectedSha, deps = {} }, operation) {
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

export async function releaseRetainedSlice({
  mainRepo,
  launchRef,
  runId,
  retryId = 0,
  disposition,
  workerTerminated,
  integrationSucceeded,
  integratedSha,
  worktreeIdentityDigest,
  reviewResolved,
  identity = null,
  deps = {}
} = {}) {
  const runGit = deps.runGit ?? defaultRunGit;
  const resolveBinding = deps.resolveBinding ?? resolveWorktreeBinding;
  const writeAudit = deps.writeAudit ?? defaultWriteAudit;
  const isConfirmedDead = deps.confirmedDead ?? confirmedDead;
  const clock = deps.clock ?? (() => new Date().toISOString());
  const repo = assertAbsolutePath(mainRepo, "mainRepo");

  if (!RETAINED_SLICE_CLEANUP_DISPOSITIONS.includes(disposition)) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.INVALID_REASON, "invalid exact-slice cleanup disposition");
  }
  if (workerTerminated !== true || (identity !== null && !isConfirmedDead(identity, deps.livenessDeps))) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.WORKER_NOT_TERMINATED, "exact-slice cleanup requires confirmed worker termination");
  }
  if (disposition === "successful-integration" && integrationSucceeded !== true) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.REVIEW_UNRESOLVED, "exact-slice integration cleanup requires successful integration");
  }
  if (disposition === "successful-integration" &&
      (typeof integratedSha !== "string" || !OID_RE.test(integratedSha) || /^0+$/u.test(integratedSha))) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING,
      "exact-slice integration cleanup requires the server-verified integrated SHA");
  }
  if (typeof worktreeIdentityDigest !== "string" || !SHA256_DIGEST_RE.test(worktreeIdentityDigest)) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING,
      "exact-slice cleanup requires the canonical retained worktree identity digest");
  }
  if (disposition !== "successful-integration" && reviewResolved !== true) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.REVIEW_UNRESOLVED, "retain the exact slice while WK review is unresolved");
  }

  const binding = resolveBinding({ mainRepo: repo, launchRef, runId, retryId });
  if (!binding || typeof binding !== "object" ||
      typeof binding.unit_address !== "string" ||
      !/^IN-\d{4}\/WK-\d{4}\/SLICE-\d{3}$/u.test(binding.unit_address) ||
      !SLICE_BRANCH_RE.test(binding.output_branch) ||
      !path.isAbsolute(binding.worktree_path) ||
      !SLICE_WORKTREE_DIR_RE.test(path.basename(binding.worktree_path))) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "resolved binding is not an exact slice binding");
  }
  const resolvedIdentityDigest = digestTrustedExactReviewEvidence(binding);
  if (resolvedIdentityDigest !== worktreeIdentityDigest) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING,
      "resolved exact-slice binding does not match the retained worktree identity digest", {
        expected_worktree_identity_digest: worktreeIdentityDigest,
        actual_worktree_identity_digest: resolvedIdentityDigest
      });
  }
  const repoReal = realpathOrLexical(repo);
  const worktreeReal = realpathOrLexical(binding.worktree_path);
  if (pathWithin(worktreeReal, repoReal) || pathWithin(repoReal, worktreeReal)) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.PROTECTED_WORKTREE, "slice worktree overlaps the main checkout");
  }

  const listed = gitResultOrRefusal(runGit, repo, ["worktree", "list", "--porcelain"]);
  const entry = parseWorktreePorcelain(listed.stdout).find((candidate) => realpathOrLexical(candidate.path) === worktreeReal);
  const branchResult = runGit({ repo, args: ["rev-parse", "--verify", `refs/heads/${binding.output_branch}^{commit}`] });
  const pathPresent = existsSync(binding.worktree_path);
  const branchPresent = Boolean(branchResult && branchResult.ok === true);
  const branchTip = branchPresent ? branchResult.stdout.trim() : null;

  const expectedTip = disposition === "successful-integration" ? integratedSha : branchTip;
  if (typeof expectedTip !== "string" || !OID_RE.test(expectedTip)) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "verified slice ref does not resolve to an expected cleanup tip");
  }
  const prior = priorExactSliceAudit(
    repo, binding, disposition, launchRef, runId, retryId, expectedTip, worktreeIdentityDigest
  );
  const priorAttempt = priorExactSliceAttempt(
    repo, binding, disposition, launchRef, runId, retryId, expectedTip, worktreeIdentityDigest
  );
  if (branchPresent && branchTip !== expectedTip) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "slice ref changed after the retained-tip binding was minted", {
      expected_tip: expectedTip,
      actual_tip: branchTip
    });
  }

  if (!pathPresent && !entry && branchPresent) {
    if (prior) {
      return withPreparedExactRefLock({
        repo,
        ref: `refs/heads/${binding.output_branch}`,
        expectedSha: expectedTip,
        deps
      }, () => Object.freeze({
        reaped: true,
        idempotent: true,
        ...prior,
        audit_dir: worktreeReaperAuditDir(repo)
      }));
    }
    if (priorAttempt) {
      return withPreparedExactRefLock({
        repo,
        ref: `refs/heads/${binding.output_branch}`,
        expectedSha: expectedTip,
        deps
      }, () => {
        const auditDir = worktreeReaperAuditDir(repo);
        const completed = Object.freeze({ ...priorAttempt, completed: true, reaped_at: clock() });
        writeAudit({ auditDir, record: completed, line: `${JSON.stringify(completed)}\n` });
        return Object.freeze({
          reaped: true,
          idempotent: false,
          recovered_after_mutation: true,
          ...completed,
          audit_dir: auditDir
        });
      });
    }
  }
  if (!pathPresent || !entry || !branchPresent ||
      (entry && (entry.branch !== binding.output_branch || entry.head !== expectedTip))) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "slice worktree/ref/binding association is missing or mismatched");
  }
  const dirty = gitResultOrRefusal(runGit, binding.worktree_path, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (dirty.stdout.length > 0) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.DIRTY_WORKTREE, "refusing to remove a dirty retained slice", { status: dirty.stdout });
  }

  const auditBase = Object.freeze({
    schema_version: WORKTREE_REAPER_SCHEMA_VERSION,
    unit_address: binding.unit_address,
    disposition,
    output_branch: binding.output_branch,
    worktree_path: binding.worktree_path,
    tip_sha: expectedTip,
    ...(disposition === "successful-integration" ? { integrated_sha: expectedTip } : {}),
    launch_ref: launchRef,
    run_id: runId,
    retry_id: retryId,
    worktree_identity_digest: worktreeIdentityDigest
  });
  const auditDir = worktreeReaperAuditDir(repo);

  const attemptRecord = Object.freeze({ ...auditBase, completed: false, started_at: clock() });
  writeAudit({ auditDir, record: attemptRecord, line: `${JSON.stringify(attemptRecord)}\n` });
  await withPreparedExactRefLock({
    repo,
    ref: `refs/heads/${binding.output_branch}`,
    expectedSha: expectedTip,
    deps
  }, () => {
    const remove = runGit({ repo, args: ["worktree", "remove", binding.worktree_path] });
    const preserved = remove?.ok === true
      ? runGit({ repo, args: ["rev-parse", "--verify", `refs/heads/${binding.output_branch}^{commit}`] })
      : null;
    const preservedTip = preserved?.ok === true ? preserved.stdout.trim() : null;
    if (!remove || remove.ok !== true || preservedTip !== expectedTip) {
      fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.REAP_FAILED, "exact-slice cleanup failed", {
        worktree_remove: remove?.stderr ?? remove?.error ?? remove?.status ?? null,
        branch_preservation: preserved?.stderr ?? preserved?.error ?? preserved?.status ?? preservedTip,
        audit: attemptRecord
      });
    }
  });

  const auditRecord = Object.freeze({ ...auditBase, completed: true, reaped_at: clock() });
  writeAudit({ auditDir, record: auditRecord, line: `${JSON.stringify(auditRecord)}\n` });
  return Object.freeze({ reaped: true, idempotent: false, ...auditRecord, audit_dir: auditDir });
}

function gitResultOrRefusal(runGit, repo, args) {
  const result = runGit({ repo, args });
  if (!result || result.ok !== true) {
    fail(WORKTREE_REAPER_DIAGNOSTIC_CODES.MISSING_OR_MISMATCHED_BINDING, "could not verify exact slice binding", {
      args,
      stderr: result?.stderr ?? result?.error ?? result?.status ?? null
    });
  }
  return result;
}
