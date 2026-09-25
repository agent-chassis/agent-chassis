#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { cleanupRunnerOwnedRoots, createRunnerOwnedTempRoot, recoverInactiveRunnerRoots } from "./helpers/test-runner-roots.mjs";
import { spawnManagedTestProcess } from "./helpers/managed-test-process.mjs";
import { createTestResourceScope } from "./helpers/test-resource-scope.mjs";
import { parseTestRunnerOptions, TestRunnerOptionError } from "./helpers/test-runner-options.mjs";
import { createRunnerOutput } from "./helpers/test-runner-output.mjs";
import { beginTestRunRecording } from "./helpers/test-run-recording.mjs";
import { renderSlowest } from "./helpers/test-timing-summary.mjs";
import { TEST_TIMING_CODES, timingFailure, timingNextAction } from "./helpers/test-timing-diagnostics.mjs";
import { TEST_RUNNER_OBSERVER_URL } from "./helpers/test-runner-observer.mjs";
import {
  createObserverFrameReader, createTestRunnerWatchdog,
  TEST_RUNNER_WATCHDOG_CODES, TestRunnerWatchdogError
} from "./helpers/test-runner-watchdog.mjs";
import { fileURLToPath } from "node:url";

import {
  INTEGRATION_DIR_REL,
  TestSuiteClassificationError,
  UNIT_DIR_REL,
  loadTestCorpus,
} from "./test-suite-classification.mjs";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");
const INTEGRATION_MODES = new Set(["integration", "all"]);

const CATCHABLE_TERMINATION_SIGNALS = Object.freeze(["SIGINT", "SIGTERM", "SIGHUP"]);

const DEFAULT_TEST_TIMEOUT_MS = 30000;

const INTEGRATION_TEST_TIMEOUT_MS = 120000;

const CREDENTIAL_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY"
];

const AGENT_IDENTITY_ENV_KEYS = [
  "AGENT_ROLE",
  "AGENT_WK",
  "AGENT_OPERATOR_WRITE_SCOPE",
  "AGENT_IN",
  "AGENT_SUBJECT"
];

const NODE_TEST_CONTEXT_ENV_KEYS = ["NODE_TEST_CONTEXT", "NODE_TEST_WORKER_ID"];

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function reportCleanupFailures(emit, failures, outcomeDescription) {
  if (failures.length === 0) return;
  emit(`[run-tests] temporary-root cleanup failed; ${outcomeDescription}\n`);
  for (const failure of failures) {
    emit(`[run-tests] cleanup root=${failure.root} code=${failure.code}: ${failure.message}\n`);
  }
}

function classify() {
  return loadTestCorpus({
    repoRoot: REPO_ROOT,
    readFile: (abs) => readFileSync(abs, "utf8"),
    listDir: (abs) => readdirSync(abs, { withFileTypes: true }),
    dirExists: (abs) => existsSync(abs),
  });
}

function buildClampedEnv(scratchHome, scratchTemp, runContextEnv) {
  const env = { ...process.env };

  env.HOME = scratchHome;
  env.XDG_CONFIG_HOME = path.join(scratchHome, ".config");
  env.XDG_STATE_HOME = path.join(scratchHome, ".local", "state");
  env.XDG_DATA_HOME = path.join(scratchHome, ".local", "share");
  env.XDG_CACHE_HOME = path.join(scratchHome, ".cache");
  env.TMPDIR = scratchTemp;
  env.TMP = scratchTemp;
  env.TEMP = scratchTemp;
  for (const dir of [
    env.XDG_CONFIG_HOME,
    env.XDG_STATE_HOME,
    env.XDG_DATA_HOME,
    env.XDG_CACHE_HOME
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  for (const key of [...CREDENTIAL_ENV_KEYS, ...AGENT_IDENTITY_ENV_KEYS, ...NODE_TEST_CONTEXT_ENV_KEYS]) {
    delete env[key];
  }

  env.PORTFOLIO_WIKI_TOOLS_HERMETIC_TESTS = "1";

  Object.assign(env, runContextEnv);
  return env;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function describeWatchdogFailure(emit, error, fileTimeoutMs, phaseTimeoutMs) {
  const detail = error.detail ?? {};
  emit(`[run-tests] ${error.code}: ${error.message}\n`);
  if (error.code === TEST_RUNNER_WATCHDOG_CODES.FILE_TIMEOUT) {
    emit(`[run-tests] elapsed=${detail.elapsedMs}ms budget=${detail.budgetMs}ms; ` +
      `reporter output may be incomplete. Operator: inspect the file with ` +
      `node tests/run-tests.mjs integration --test-file-timeout=${fileTimeoutMs} ` +
      `${shellQuote(detail.file)}; increase --test-file-timeout deliberately if needed.\n`);
  } else if (error.code === TEST_RUNNER_WATCHDOG_CODES.PHASE_TIMEOUT ||
             error.code === TEST_RUNNER_WATCHDOG_CODES.STARTUP_TIMEOUT) {
    emit(`[run-tests] phase=${detail.phase} elapsed=${detail.elapsedMs}ms ` +
      `budget=${detail.budgetMs}ms. Operator: inspect global setup/reporter teardown; ` +
      `increase --test-runner-phase-timeout=${phaseTimeoutMs} deliberately if needed.\n`);
  } else {
    emit("[run-tests] runner maintainer: inspect the observer protocol and retained " +
      "Node diagnostic; a partial reporter artifact is not a pass.\n");
  }
}

function runStatus({ requestedSignal, outputLost, watchdogFailure, operationalError, result }) {
  if (requestedSignal) return "operator_signal";
  if (outputLost) return "output_lost";
  if (watchdogFailure) return "watchdog_expired";
  if (operationalError || result === null) return "setup_failed";
  if (result.error) return "spawn_failed";
  return result.code === 0 && result.signal === null ? "tests_passed" : "tests_failed";
}

function listCorpus(unit, integration) {
  process.stdout.write(`unit (${unit.length}) [${UNIT_DIR_REL}/]:\n`);
  for (const file of unit) process.stdout.write(`  ${file}\n`);
  process.stdout.write(`\nintegration (${integration.length}) [${INTEGRATION_DIR_REL}/]:\n`);
  for (const file of integration) process.stdout.write(`  ${file}\n`);
}

async function main(output) {
  const emit = (text) => output.message(text);

  const callerTempDir = os.tmpdir();
  const argv = process.argv.slice(2);
  const mode = argv[0] && !argv[0].startsWith("-") && !argv[0].includes(path.sep)
    ? argv[0] : "unit";
  const passthrough = mode === argv[0] ? argv.slice(1) : argv;
  let unit;
  let integration;
  try {
    ({ unit, integration } = classify());
  } catch (error) {
    if (!(error instanceof TestSuiteClassificationError)) throw error;
    emit(`[run-tests] ${error.code}\n${error.message}\n`);
    return { exitCode: 3 };
  }
  if (mode === "list") return { list: () => listCorpus(unit, integration) };
  let files;
  if (mode === "unit") files = unit;
  else if (mode === "integration") files = integration;
  else if (mode === "all") files = [...unit, ...integration].sort();
  else {
    emit(`unknown mode ${JSON.stringify(mode)}; expected unit | integration | all | list\n`);
    return { exitCode: 2 };
  }

  let options;
  try {
    options = parseTestRunnerOptions(passthrough, { repoRoot: REPO_ROOT, selectedFiles: files });
  } catch (error) {
    if (!(error instanceof TestRunnerOptionError)) throw error;
    emit(`[run-tests] ${error.code}: ${error.message}\n`);
    return { exitCode: 2 };
  }
  const serializeFiles = INTEGRATION_MODES.has(mode);
  const timeoutMs = mode === "unit" ? DEFAULT_TEST_TIMEOUT_MS : INTEGRATION_TEST_TIMEOUT_MS;
  const reporterOptions = [...options.native];
  if (options.reporterCount === 0) {
    reporterOptions.push("--test-reporter=spec", "--test-reporter-destination=stdout");
  } else if (options.reporterCount === 1 && options.destinationCount === 0) {
    reporterOptions.push("--test-reporter-destination=stdout");
  }
  reporterOptions.push(`--test-reporter=${TEST_RUNNER_OBSERVER_URL}`,
    "--test-reporter-destination=stdout");
  const nodeArgs = ["--test",
    ...(options.hasTimeout ? [] : [`--test-timeout=${timeoutMs}`]),
    ...(serializeFiles && !options.hasConcurrency ? ["--test-concurrency=1"] : []),
    ...reporterOptions, ...options.files];

  let recovery;
  try {
    recovery = recoverInactiveRunnerRoots();
  } catch (error) {
    emit(`[run-tests] stale temporary-root recovery failed: ${errorMessage(error)}\n`);
    return { exitCode: 1 };
  }
  for (const recovered of recovery.removed) {
    emit(`[run-tests] recovered inactive temporary root ${recovered}\n`);
  }
  if (recovery.failures.length > 0) {
    reportCleanupFailures(emit, recovery.failures, "child outcome=not-started (stale-root recovery)");
    return { exitCode: 1 };
  }

  const roots = [];
  const resources = createTestResourceScope();
  let recording = null;
  let managed;
  let watchdog;
  let pipeEnded = false;
  let earlyEofTimer = null;
  let result = null;
  let operationalError = null;
  let settlementError = null;
  let resourceError = null;
  let requestedSignal = null;
  let outputLost = null;
  let settling = false;
  let artifactCreateFailed = false;
  let watchdogSecondary = false;
  const pendingRecordingFailures = [];
  const recordFailure = (failure) => {
    if (recording) recording.recordFailure(failure);
    else pendingRecordingFailures.push(failure);
  };

  const settle = () => {
    if (settling) return;
    settling = true;
    output.settle();
    watchdog?.dispose();
    stopSuite();
  };
  const stopSuite = () => {
    if (managed) void managed.stop().catch((error) => { settlementError ??= error; });
  };
  output.onFailureObserved((failure, { soft }) => {
    recordFailure(timingFailure(TEST_TIMING_CODES.ARTIFACT_WRITE_FAILED,
      `${failure.sink} ${soft ? "overflowed" : "failed"}: ${failure.code} ${failure.message}`,
      { sink: failure.sink }));
    if (!soft && (failure.sink === "stdout" || failure.sink === "stderr")) {
      outputLost ??= failure;
      settle();
    }
  });
  const signalHandlers = new Map();
  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  };
  try {
    const home = createRunnerOwnedTempRoot("home");
    roots.push(home);
    const temp = createRunnerOwnedTempRoot("temp");
    roots.push(temp);
    try {
      recording = await beginTestRunRecording({ repoRoot: REPO_ROOT, mode, options,
        selectedFiles: options.files, callerTempDir, currentRoots: roots.map((root) => root.path),
        output });
    } catch (error) {
      const code = error?.code ?? TEST_TIMING_CODES.ARTIFACT_CREATE_FAILED;
      emit(`[run-tests] ${code}: ${errorMessage(error)}\n[run-tests] ${timingNextAction(code) ??
        timingNextAction(TEST_TIMING_CODES.ARTIFACT_CREATE_FAILED)}\n`);
      operationalError = error;
      artifactCreateFailed = true;
      throw error;
    }
    for (const failure of pendingRecordingFailures.splice(0)) recording.recordFailure(failure);
    emit(`[run-tests] artifacts=${recording.runDir} run=${recording.runId}\n`);
    const env = buildClampedEnv(home.path, temp.path, recording.contextEnv);
    watchdog = createTestRunnerWatchdog({
      files: options.files, fileTimeoutMs: options.fileTimeoutMs,
      phaseTimeoutMs: options.phaseTimeoutMs,
      allowUnscheduledFiles: options.hasShard,
      onProgress: (event) => {
        if (event.type === "START") {
          emit(`[run-tests] START ${event.file} budget=${event.budgetMs}ms\n`);
        } else {
          emit(`[run-tests] FINISH ${event.file} elapsed=${event.elapsedMs}ms ` +
            `outcome=${event.outcome}\n`);
        }
      },
      onRecordingFailure: (status) => {
        recordFailure(timingFailure(TEST_TIMING_CODES.TIMING_INCOMPLETE,
          `native timing sink failed (${status.code}): ${status.message}`, { producer: "observer" }));
        emit(`[run-tests] ${status.code}: native timing recording stopped: ${status.message}\n`);
      },

      onFailure: () => {
        if (settling) watchdogSecondary = true;
        settle();
      }
    });
    resources.add("watchdog timers", () => watchdog.dispose());
    managed = spawnManagedTestProcess({ command: process.execPath, args: nodeArgs,
      spawnOptions: { cwd: REPO_ROOT, env, stdio: ["inherit", "pipe", "pipe", "pipe"] }
    }, { displayLabel: "node --test suite", naturalExitTimeoutMs: 0,
      sigtermTimeoutMs: 5000, sigkillTimeoutMs: 5000,
      stdoutTailBytes: 0, stderrTailBytes: 0 });
    resources.add("suite process group", () => managed.stop());

    for (const stream of ["stdout", "stderr"]) {
      managed.child[stream].on("data", (chunk) => {
        if (!output.forward(stream, chunk)) managed.child[stream].pause();
      });
    }
    output.onRelief(() => {
      for (const stream of ["stdout", "stderr"]) {
        if (managed.child[stream].isPaused()) managed.child[stream].resume();
      }
    });
    const control = managed.child.stdio[3];
    resources.add("observer control pipe", () => control.destroy());
    resources.add("observer early-EOF timer", () => {
      if (earlyEofTimer !== null) clearTimeout(earlyEofTimer);
    });
    const reader = createObserverFrameReader({
      onFrame: (frame) => watchdog.accept(frame),
      onFailure: (error) => watchdog.fail(error)
    });
    control.on("data", (chunk) => reader.push(chunk));
    control.once("end", () => {
      pipeEnded = true;
      reader.end();
      if (!watchdog.streamEnd && !watchdog.failure) {
        if (watchdog.hello) {
          watchdog.fail(new TestRunnerWatchdogError(TEST_RUNNER_WATCHDOG_CODES.LOST,
            "observer pipe closed before stream completion"));
        } else {

          earlyEofTimer = setTimeout(() => {
            if (managed.child.exitCode === null && managed.child.signalCode === null &&
                !watchdog.failure) {
              watchdog.fail(new TestRunnerWatchdogError(TEST_RUNNER_WATCHDOG_CODES.LOST,
                "observer pipe closed before HELLO while the suite process was live"));
            }
          }, 100);
        }
      }
    });
    control.once("error", (error) => watchdog.fail(new TestRunnerWatchdogError(
      TEST_RUNNER_WATCHDOG_CODES.LOST, `observer pipe failed: ${errorMessage(error)}`)));
    for (const signal of CATCHABLE_TERMINATION_SIGNALS) {
      const handler = () => {
        if (requestedSignal === null) requestedSignal = signal;
        settle();
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
    emit(`[run-tests] mode=${mode} files=${options.files.length} ` +
      `HOME=${home.path} TMPDIR=${temp.path} timeout=${timeoutMs}ms ` +
      `file_timeout=${options.fileTimeoutMs}ms phase_timeout=${options.phaseTimeoutMs}ms` +
      `${serializeFiles && !options.hasConcurrency ? " concurrency=1" : ""}\n`);

    if (settling) stopSuite();
    try {
      result = await managed.waitForExit();
    } catch (error) {
      settlementError = error;
    }
    if (result !== null && requestedSignal === null && outputLost === null) {
      watchdog.finalize(result, { pipeEnded });
    }
  } catch (error) {
    operationalError ??= error;
    if (managed) {
      output.settle();
      try { result = await managed.stop(); } catch (stopError) { settlementError = stopError; }
    }
  } finally {
    removeSignalHandlers();
    watchdog?.dispose();

    try { await resources.dispose(); } catch (error) { resourceError = error; }
  }
  return finish();

  async function finish() {
    const watchdogFailure = watchdogSecondary ? null : watchdog?.failure ?? null;
    const disposeLogs = () => recording?.closeLogs();
    if (managed && (settlementError !== null || result === null)) {
      emit(`[run-tests] ${TEST_RUNNER_WATCHDOG_CODES.TERMINATION_FAILED}: ` +
        `${errorMessage(settlementError)}; suite group settlement unconfirmed. ` +
        `Runner-owned roots retained: ${roots.map((root) => root.path).join(", ")}. ` +
        "Operator: inspect the group and roots before recovery.\n");
      recording?.writeFinal({ status: "settlement_unconfirmed", native: null,
        summary: { recording: { status: "incomplete" } } });
      return { exitCode: 1, drain: options.phaseTimeoutMs, disposeLogs, recording };
    }
    const cleanupFailures = cleanupRunnerOwnedRoots(roots);
    reportCleanupFailures(emit, cleanupFailures,
      result === null ? "child outcome=not-started" : `child outcome=exit code=${result.code}`);
    if (operationalError && !artifactCreateFailed) {
      emit(`[run-tests] runner setup failed: ${errorMessage(operationalError)}\n`);
    }
    if (resourceError) {
      emit(`[run-tests] runner resource cleanup failed: ${errorMessage(resourceError)}\n`);
    }
    if (watchdogFailure) {
      emit("[run-tests] owned suite group settlement confirmed; runner-owned " +
        `roots removed=${cleanupFailures.length === 0}; detached process groups are outside ` +
        "this runner's ownership. Reporter output may be incomplete.\n");
      describeWatchdogFailure(emit, watchdog.failure, options.fileTimeoutMs, options.phaseTimeoutMs);
    }
    if (outputLost !== null) {
      emit(`[run-tests] output destination ${outputLost.sink} failed (${outputLost.code}); ` +
        "the suite was stopped through owned settlement and the run is not a pass.\n");
    }
    if (result?.error) {
      emit(`[run-tests] failed to spawn node --test: ${errorMessage(result.error)}\n`);
    }
    const status = runStatus({ requestedSignal, outputLost, watchdogFailure,
      operationalError, result });
    let recordingComplete = recording === null;
    if (recording !== null) {
      const summary = recording.finalize({ status, native: result === null ? null : {
        exit_code: result.code, signal: result.signal,
        watchdog: watchdog?.failure ? { code: watchdog.failure.code, message: watchdog.failure.message,
          primary: !watchdogSecondary } : null,
        requested_signal: requestedSignal } });
      recordingComplete = summary.recording.status === "complete";
      emit(renderSlowest(summary));
      emit(`[run-tests] run status=${status} recording=${summary.recording.status} ` +
        `artifacts=${recording.runDir}\n`);
      if (!recordingComplete) {
        const first = summary.recording.failures[0];
        emit(`[run-tests] ${first?.code ?? TEST_TIMING_CODES.TIMING_INCOMPLETE}: timing capture is ` +
          `incomplete (${first?.message ?? "unfinished or unreadable records"}); see ` +
          `${path.join(recording.runDir, "summary.json")}. ` +
          `${timingNextAction(first?.code ?? TEST_TIMING_CODES.TIMING_INCOMPLETE)}\n`);
      }
    }
    const base = { drain: options.phaseTimeoutMs, disposeLogs, recording };
    if (requestedSignal) return { ...base, signal: requestedSignal };
    if (!watchdogFailure && outputLost === null && result?.signal) {
      return { ...base, signal: result.signal };
    }
    const failed = cleanupFailures.length > 0 || watchdogFailure || result?.error ||
      operationalError || resourceError || outputLost !== null || !recordingComplete;
    return { ...base, exitCode: failed ? 1 : (result?.code ?? 1) };
  }
}

async function run() {
  const output = createRunnerOutput();
  let outcome;
  try {
    outcome = await main(output);
  } catch (error) {
    output.message(`[run-tests] runner failed: ${errorMessage(error)}\n`);
    outcome = { exitCode: 1, drain: 30_000 };
  }
  if (outcome.list) {
    outcome.list();
    return;
  }
  const drained = await output.drain(outcome.drain ?? 30_000);
  outcome.disposeLogs?.();
  if (!drained) {
    outcome.recording?.markOutputDrainExhausted(outcome.drain ?? 30_000);
    process.exit(1);
  }
  if (outcome.signal) {
    process.kill(process.pid, outcome.signal);
    return;
  }
  process.exitCode = outcome.exitCode;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const isDirectRun = invokedPath === fileURLToPath(import.meta.url);
if (isDirectRun) void run();
