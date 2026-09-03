#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  writeSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  INTEGRATION_DIR_REL,
  TestSuiteClassificationError,
  UNIT_DIR_REL,
  loadTestCorpus,
} from "./test-suite-classification.mjs";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, "..");
const TEST_TEMP_PARENT = "/tmp";
const RUNNER_ROOT_MARKER = ".agent-chassis-runner-owned.json";
const RUNNER_ROOT_MARKER_SCHEMA = "agent-chassis-test-runner-root.v1";
const RUNNER_ROOT_REPOSITORY = "agent-chassis/agent-chassis";
const RUNNER_ROOT_SPECS = Object.freeze({
  home: Object.freeze({
    prefix: "agent-chassis-hermetic-home-",
    purpose: "hermetic-home"
  }),
  temp: Object.freeze({
    prefix: "agent-chassis-test-tmp-",
    purpose: "test-tmp"
  })
});
const CATCHABLE_TERMINATION_SIGNALS = Object.freeze(["SIGINT", "SIGTERM"]);
const SIGNAL_GRACE_MS = 5000;
const PROC_BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id";

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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function writeStderr(message) {
  writeSync(process.stderr.fd, message);
}

function runnerRootSpecForName(name) {
  for (const [kind, spec] of Object.entries(RUNNER_ROOT_SPECS)) {
    if (!name.startsWith(spec.prefix)) continue;
    const suffix = name.slice(spec.prefix.length);
    if (/^[A-Za-z0-9]{6}$/u.test(suffix)) return { kind, ...spec };
  }
  return null;
}

function boundedRunnerRootPath(rootPath) {
  const resolved = path.resolve(rootPath);
  if (path.dirname(resolved) !== path.resolve(TEST_TEMP_PARENT)) return null;
  const spec = runnerRootSpecForName(path.basename(resolved));
  return spec ? { path: resolved, ...spec } : null;
}

function readLinuxBootId() {
  if (process.platform !== "linux" || !existsSync(PROC_BOOT_ID_PATH)) return null;
  const bootId = readFileSync(PROC_BOOT_ID_PATH, "utf8").trim();
  return bootId.length > 0 ? bootId : null;
}

function parseLinuxProcessStartTicks(statText, pid) {
  const closeParen = statText.lastIndexOf(") ");
  if (closeParen < 0) throw new Error(`malformed /proc/${pid}/stat: missing command terminator`);
  const fieldsFromState = statText.slice(closeParen + 2).trim().split(/\s+/u);
  const startTicks = fieldsFromState[19];
  if (!/^\d+$/u.test(startTicks ?? "")) {
    throw new Error(`malformed /proc/${pid}/stat: missing process start time`);
  }
  return startTicks;
}

function inspectLinuxProcess(pid) {
  if (process.platform !== "linux") return { state: "unknown", reason: "non-linux host" };
  const statPath = `/proc/${pid}/stat`;
  try {
    const statText = readFileSync(statPath, "utf8");
    return { state: "present", startTicks: parseLinuxProcessStartTicks(statText, pid) };
  } catch (error) {
    if (error && error.code === "ENOENT") return { state: "absent" };
    return { state: "unknown", reason: errorMessage(error) };
  }
}

function currentRunnerOwnerIdentity() {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  const bootId = readLinuxBootId();
  const processIdentity = inspectLinuxProcess(process.pid);
  return Object.freeze({
    pid: process.pid,
    uid,
    boot_id: bootId,
    process_start_ticks: processIdentity.state === "present"
      ? processIdentity.startTicks
      : null
  });
}

function cleanupFailure(rootPath, error) {
  return Object.freeze({
    root: rootPath,
    code: error && typeof error.code === "string" ? error.code : "runner_temp_cleanup_failed",
    message: errorMessage(error)
  });
}

function makeRunnerRootRemovable(rootPath, rootStat) {
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (currentUid === null || rootStat.uid !== currentUid) {
    const error = new Error(`runner temp root is not owned by the runner uid: ${rootPath}`);
    error.code = "runner_temp_cleanup_owner_refused";
    throw error;
  }
  const visit = (directory) => {
    const directoryStat = lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      const error = new Error(`runner temp cleanup encountered a substituted directory: ${directory}`);
      error.code = "runner_temp_cleanup_substitution_refused";
      throw error;
    }
    if (directoryStat.uid !== currentUid || directoryStat.dev !== rootStat.dev) {
      const error = new Error(`runner temp cleanup crossed an ownership or mount boundary: ${directory}`);
      error.code = "runner_temp_cleanup_boundary_refused";
      throw error;
    }
    chmodSync(directory, 0o700);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = path.join(directory, entry.name);
      let childStat;
      try {
        childStat = lstatSync(child);
      } catch (error) {
        if (error && error.code === "ENOENT") continue;
        throw error;
      }
      if (childStat.isSymbolicLink()) continue;
      if (childStat.isDirectory()) visit(child);
    }
  };
  visit(rootPath);
}

function removeBoundedRunnerRoot(rootPath, expectedIdentity = null) {
  const bounded = boundedRunnerRootPath(rootPath);
  if (!bounded) {
    const error = new Error(`refusing cleanup outside an exact runner temp root: ${rootPath}`);
    error.code = "runner_temp_cleanup_path_refused";
    throw error;
  }
  let rootStat;
  try {
    rootStat = lstatSync(bounded.path);
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || realpathSync(bounded.path) !== bounded.path) {
    const error = new Error(`runner temp root was substituted before cleanup: ${bounded.path}`);
    error.code = "runner_temp_cleanup_substitution_refused";
    throw error;
  }
  if (
    expectedIdentity &&
    (rootStat.dev !== expectedIdentity.dev || rootStat.ino !== expectedIdentity.ino)
  ) {
    const error = new Error(`runner temp root identity changed before cleanup: ${bounded.path}`);
    error.code = "runner_temp_cleanup_identity_refused";
    throw error;
  }
  makeRunnerRootRemovable(bounded.path, rootStat);
  rmSync(bounded.path, { recursive: true, force: true });
  if (existsSync(bounded.path)) {
    const error = new Error(`runner temp root still exists after cleanup: ${bounded.path}`);
    error.code = "runner_temp_cleanup_incomplete";
    throw error;
  }
}

export function cleanupRunnerOwnedRoots(roots) {
  const failures = [];
  for (const root of [...roots].reverse()) {
    try {
      removeBoundedRunnerRoot(root.path, root.rootIdentity);
    } catch (error) {
      failures.push(cleanupFailure(root.path, error));
    }
  }
  return Object.freeze(failures);
}

export function createRunnerOwnedTempRoot(kind) {
  const spec = RUNNER_ROOT_SPECS[kind];
  if (!spec) throw new Error(`unknown runner temp-root kind: ${kind}`);
  const rootPath = mkdtempSync(path.join(TEST_TEMP_PARENT, spec.prefix));
  try {
    chmodSync(rootPath, 0o700);
    const marker = Object.freeze({
      schema_version: RUNNER_ROOT_MARKER_SCHEMA,
      repository: RUNNER_ROOT_REPOSITORY,
      purpose: spec.purpose,
      root_basename: path.basename(rootPath),
      owner: currentRunnerOwnerIdentity()
    });
    writeFileSync(
      path.join(rootPath, RUNNER_ROOT_MARKER),
      `${JSON.stringify(marker)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 }
    );
    const rootStat = lstatSync(rootPath);
    return Object.freeze({
      kind,
      path: rootPath,
      rootIdentity: Object.freeze({ dev: rootStat.dev, ino: rootStat.ino })
    });
  } catch (error) {
    const failures = cleanupRunnerOwnedRoots([{ kind, path: rootPath }]);
    if (failures.length > 0) {
      const setupError = new Error(
        `runner temp-root setup failed (${errorMessage(error)}); ` +
        `partial cleanup also failed (${failures.map((failure) => failure.message).join("; ")})`,
        { cause: error }
      );
      setupError.code = "runner_temp_setup_and_cleanup_failed";
      setupError.cleanupFailures = failures;
      throw setupError;
    }
    throw error;
  }
}

function inspectRunnerRootOwnership(rootPath) {
  const bounded = boundedRunnerRootPath(rootPath);
  if (!bounded) return { state: "unproven", reason: "path is not an exact runner root" };

  let rootStat;
  let markerStat;
  let rootRealPath;
  let markerText;
  try {
    rootStat = lstatSync(bounded.path);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return { state: "unproven", reason: "root is not a plain directory" };
    }
    rootRealPath = realpathSync(bounded.path);
    if (rootRealPath !== bounded.path) {
      return { state: "unproven", reason: "root does not resolve to its exact /tmp path" };
    }
    const markerPath = path.join(bounded.path, RUNNER_ROOT_MARKER);
    markerStat = lstatSync(markerPath);
    if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.nlink !== 1) {
      return { state: "unproven", reason: "ownership marker is not a single-link plain file" };
    }
    markerText = readFileSync(markerPath, "utf8");
  } catch (error) {
    return { state: "unproven", reason: errorMessage(error) };
  }

  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (currentUid === null || rootStat.uid !== currentUid || markerStat.uid !== currentUid) {
    return { state: "unproven", reason: "root and marker are not owned by the runner uid" };
  }
  if ((rootStat.mode & 0o777) !== 0o700 || (markerStat.mode & 0o777) !== 0o600) {
    return { state: "unproven", reason: "root or marker permissions do not match runner ownership" };
  }

  let marker;
  try {
    marker = JSON.parse(markerText);
  } catch (error) {
    return { state: "unproven", reason: `invalid ownership marker: ${errorMessage(error)}` };
  }
  if (
    marker?.schema_version !== RUNNER_ROOT_MARKER_SCHEMA ||
    marker?.repository !== RUNNER_ROOT_REPOSITORY ||
    marker?.purpose !== bounded.purpose ||
    marker?.root_basename !== path.basename(bounded.path) ||
    marker?.owner?.uid !== currentUid ||
    !Number.isSafeInteger(marker?.owner?.pid) ||
    marker.owner.pid <= 0 ||
    typeof marker.owner.boot_id !== "string" ||
    marker.owner.boot_id.length === 0 ||
    typeof marker.owner.process_start_ticks !== "string" ||
    !/^\d+$/u.test(marker.owner.process_start_ticks)
  ) {
    return { state: "unproven", reason: "ownership marker fields do not match the root" };
  }
  return {
    state: "proven",
    bounded,
    marker,
    markerText,
    rootIdentity: Object.freeze({ dev: rootStat.dev, ino: rootStat.ino })
  };
}

function inspectRunnerRootLiveness(proof, currentBootId) {
  if (proof.marker.owner.boot_id !== currentBootId) {
    return { state: "inactive", reason: "owner boot no longer active" };
  }
  const processIdentity = inspectLinuxProcess(proof.marker.owner.pid);
  if (processIdentity.state === "absent") {
    return { state: "inactive", reason: "owner process no longer exists" };
  }
  if (processIdentity.state !== "present") {
    return { state: "unknown", reason: processIdentity.reason };
  }
  if (processIdentity.startTicks !== proof.marker.owner.process_start_ticks) {
    return { state: "inactive", reason: "owner pid has been reused" };
  }
  return { state: "active" };
}

function sameRunnerRootProof(first, second) {
  return second.state === "proven" &&
    second.markerText === first.markerText &&
    second.rootIdentity.dev === first.rootIdentity.dev &&
    second.rootIdentity.ino === first.rootIdentity.ino;
}

export function recoverInactiveRunnerRoots() {
  const currentBootId = readLinuxBootId();
  if (currentBootId === null) {
    return Object.freeze({ removed: Object.freeze([]), failures: Object.freeze([]) });
  }
  const removed = [];
  const failures = [];
  const entries = readdirSync(TEST_TEMP_PARENT, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !runnerRootSpecForName(entry.name)) continue;
    const rootPath = path.join(TEST_TEMP_PARENT, entry.name);
    const firstProof = inspectRunnerRootOwnership(rootPath);
    if (firstProof.state !== "proven") continue;
    if (inspectRunnerRootLiveness(firstProof, currentBootId).state !== "inactive") continue;

    const secondProof = inspectRunnerRootOwnership(rootPath);
    if (!sameRunnerRootProof(firstProof, secondProof)) continue;
    if (inspectRunnerRootLiveness(secondProof, currentBootId).state !== "inactive") continue;
    try {
      removeBoundedRunnerRoot(rootPath, secondProof.rootIdentity);
      removed.push(rootPath);
    } catch (error) {
      failures.push(cleanupFailure(rootPath, error));
    }
  }
  return Object.freeze({
    removed: Object.freeze(removed),
    failures: Object.freeze(failures)
  });
}

function reportCleanupFailures(failures, outcomeDescription) {
  if (failures.length === 0) return;
  writeStderr(
    `[run-tests] temporary-root cleanup failed; ${outcomeDescription}\n`
  );
  for (const failure of failures) {
    writeStderr(
      `[run-tests] cleanup root=${failure.root} code=${failure.code}: ${failure.message}\n`
    );
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

function buildClampedEnv(scratchHome, scratchTemp) {
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
  for (const key of [...CREDENTIAL_ENV_KEYS, ...AGENT_IDENTITY_ENV_KEYS]) {
    delete env[key];
  }

  env.PORTFOLIO_WIKI_TOOLS_HERMETIC_TESTS = "1";
  return env;
}

function main() {

  process.stdout.on("error", (err) => {
    if (err && err.code === "EPIPE") {
      process.exit(0);
      return;
    }
    writeStderr(`[run-tests] stdout failed: ${errorMessage(err)}\n`);
    process.exit(1);
  });

  const argv = process.argv.slice(2);
  const mode = argv[0] && !argv[0].startsWith("-") && !argv[0].includes(path.sep)
    ? argv[0]
    : "unit";
  const passthrough = mode === argv[0] ? argv.slice(1) : argv;

  let unit;
  let integration;
  try {
    ({ unit, integration } = classify());
  } catch (err) {
    if (!(err instanceof TestSuiteClassificationError)) throw err;
    writeStderr(`[run-tests] ${err.code}\n${err.message}\n`);
    process.exit(3);
  }

  if (mode === "list") {
    process.stdout.write(`unit (${unit.length}) [${UNIT_DIR_REL}/]:\n`);
    for (const f of unit) process.stdout.write(`  ${f}\n`);
    process.stdout.write(`\nintegration (${integration.length}) [${INTEGRATION_DIR_REL}/]:\n`);
    for (const f of integration) process.stdout.write(`  ${f}\n`);
    return;
  }

  let files;
  if (mode === "unit") files = unit;
  else if (mode === "integration") files = integration;
  else if (mode === "all") files = [...unit, ...integration].sort();
  else {
    writeStderr(
      `unknown mode "${mode}"; expected unit | integration | all | list\n`
    );
    process.exit(2);
  }

  const explicitFiles = passthrough.filter(
    (a) => !a.startsWith("-") && a.endsWith(".test.mjs")
  );
  const flags = passthrough.filter((a) => a.startsWith("-"));
  const targetFiles = explicitFiles.length > 0 ? explicitFiles : files;

  const hasTimeoutFlag = flags.some((f) => f.startsWith("--test-timeout"));

  const timeoutMs = mode === "unit"
    ? DEFAULT_TEST_TIMEOUT_MS
    : INTEGRATION_TEST_TIMEOUT_MS;
  const nodeArgs = [
    "--test",
    ...(hasTimeoutFlag ? [] : [`--test-timeout=${timeoutMs}`]),
    ...flags,
    ...targetFiles
  ];

  let recovery;
  try {
    recovery = recoverInactiveRunnerRoots();
  } catch (error) {
    writeStderr(
      `[run-tests] stale temporary-root recovery failed before child start: ${errorMessage(error)}\n`
    );
    process.exit(1);
  }
  for (const recovered of recovery.removed) {
    writeStderr(`[run-tests] recovered inactive temporary root ${recovered}\n`);
  }
  if (recovery.failures.length > 0) {
    reportCleanupFailures(recovery.failures, "child outcome=not-started (stale-root recovery)");
    process.exit(1);
  }

  const roots = [];
  let scratchHomeRoot;
  let scratchTempRoot;
  let child = null;
  let finished = false;
  let requestedSignal = null;
  let signalGraceTimer = null;
  const signalHandlers = new Map();

  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  };

  const emergencyCleanup = () => {
    if (finished) return;
    finished = true;
    removeSignalHandlers();
    const failures = cleanupRunnerOwnedRoots(roots);
    writeStderr("[run-tests] runner exited before the child produced a terminal outcome\n");
    reportCleanupFailures(failures, "child outcome=unsettled (runner failure)");
    process.exitCode = 1;
  };
  process.once("exit", emergencyCleanup);

  const finish = (outcome) => {
    if (finished) return;
    finished = true;
    if (signalGraceTimer !== null) clearTimeout(signalGraceTimer);
    removeSignalHandlers();
    process.off("exit", emergencyCleanup);

    const failures = cleanupRunnerOwnedRoots(roots);
    let outcomeDescription;
    if (outcome.error) {
      outcomeDescription = `child outcome=spawn-error (${errorMessage(outcome.error)})`;
    } else if (outcome.signal) {
      outcomeDescription = `child outcome=signal ${outcome.signal}`;
    } else {
      outcomeDescription = `child outcome=exit code=${outcome.code === null ? "null" : outcome.code}`;
    }
    reportCleanupFailures(failures, outcomeDescription);

    if (outcome.error) {
      writeStderr(`[run-tests] failed to spawn node --test: ${errorMessage(outcome.error)}\n`);
    }

    const terminalSignal = requestedSignal ?? outcome.signal;
    if (terminalSignal) {
      try {
        process.kill(process.pid, terminalSignal);
      } catch (error) {
        writeStderr(
          `[run-tests] failed to preserve child signal ${terminalSignal}: ${errorMessage(error)}\n`
        );
        process.exit(1);
      }
      return;
    }

    let exitCode = outcome.error ? 1 : (outcome.code ?? 1);
    if (failures.length > 0 && exitCode === 0) exitCode = 1;
    process.exit(exitCode);
  };

  const forward = (signal) => {
    if (requestedSignal === null) requestedSignal = signal;
    if (child === null) {
      finish({ code: null, signal, error: null });
      return;
    }
    try {
      child.kill(signal);
    } catch (error) {
      writeStderr(
        `[run-tests] failed to forward ${signal} to child: ${errorMessage(error)}\n`
      );
    }
    if (signalGraceTimer === null) {
      signalGraceTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch (error) {
          writeStderr(
            `[run-tests] failed to stop child after ${SIGNAL_GRACE_MS}ms signal grace: ` +
            `${errorMessage(error)}\n`
          );
        }
      }, SIGNAL_GRACE_MS);
    }
  };
  for (const signal of CATCHABLE_TERMINATION_SIGNALS) {
    const handler = () => forward(signal);
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  try {
    scratchHomeRoot = createRunnerOwnedTempRoot("home");
    roots.push(scratchHomeRoot);
    scratchTempRoot = createRunnerOwnedTempRoot("temp");
    roots.push(scratchTempRoot);
    child = spawn(process.execPath, nodeArgs, {
      cwd: REPO_ROOT,
      env: buildClampedEnv(scratchHomeRoot.path, scratchTempRoot.path),
      stdio: "inherit"
    });
    child.once("exit", (code, signal) => finish({ code, signal, error: null }));
    child.once("error", (error) => finish({ code: null, signal: null, error }));
  } catch (error) {
    finished = true;
    removeSignalHandlers();
    process.off("exit", emergencyCleanup);
    const setupCleanupFailures = error && Array.isArray(error.cleanupFailures)
      ? error.cleanupFailures
      : [];
    const failures = [...setupCleanupFailures, ...cleanupRunnerOwnedRoots(roots)];
    writeStderr(`[run-tests] runner setup failed: ${errorMessage(error)}\n`);
    reportCleanupFailures(failures, "child outcome=not-started (runner setup failure)");
    process.exit(1);
  }

  writeStderr(
    `[run-tests] mode=${mode} files=${targetFiles.length} ` +
      `HOME=${scratchHomeRoot.path} TMPDIR=${scratchTempRoot.path} ` +
      `timeout=${timeoutMs}ms\n`
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const isDirectRun = invokedPath === fileURLToPath(import.meta.url);
if (isDirectRun) main();
