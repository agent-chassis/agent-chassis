import path from "node:path";

export const TEST_RUNNER_OPTION_CODES = Object.freeze({
  INVALID: "test_runner.invalid_option.v1",
  UNSUPPORTED: "test_runner.unsupported_execution_shape.v1"
});

const VALUE_OPTIONS = new Set([
  "--test-file-timeout", "--test-runner-phase-timeout", "--test-reporter",
  "--test-reporter-destination", "--test-concurrency", "--test-timeout",
  "--test-name-pattern", "--test-skip-pattern", "--test-shard",
  "--test-isolation", "--test-global-setup", "--test-coverage-include",
  "--test-coverage-exclude", "--test-coverage-lines", "--test-coverage-branches",
  "--test-coverage-functions", "--import", "--require", "-r", "--loader",
  "--conditions", "-C", "--test-artifacts-dir", "--test-diagnostic-kind"
]);
const WRAPPER_OPTIONS = new Set(["--test-file-timeout", "--test-runner-phase-timeout",
  "--test-artifacts-dir", "--test-diagnostic-kind"]);

const DIAGNOSTIC_KINDS = new Set(["focused", "baseline"]);
const VALUELESS_OPTIONS = new Set([
  "--test-only", "--test-force-exit", "--experimental-test-coverage",
  "--test-update-snapshots"
]);
const RESERVED_GLOB = /[*?\[\]{}]/u;
const MAX_BUDGET_MS = 2_147_483_647;

export class TestRunnerOptionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TestRunnerOptionError";
    this.code = code;
  }
}

function invalid(message) {
  throw new TestRunnerOptionError(TEST_RUNNER_OPTION_CODES.INVALID, message);
}

function budget(value, name) {
  if (!/^[0-9]+$/u.test(value) || value.length > 10) {
    invalid(`${name} must be a positive decimal integer from 1 to ${MAX_BUDGET_MS} milliseconds`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_BUDGET_MS) {
    invalid(`${name} must be a positive decimal integer from 1 to ${MAX_BUDGET_MS} milliseconds`);
  }
  return parsed;
}

export function parseTestRunnerOptions(tokens, { repoRoot, selectedFiles }) {
  const native = [];
  const explicit = [];
  const seenWrapper = new Set();
  let fileTimeoutMs = 600_000;
  let phaseTimeoutMs = 30_000;
  let artifactsDir = null;
  let diagnosticKind = "focused";
  const wrapperFlags = [];
  let reporterCount = 0;
  let destinationCount = 0;
  let hasTimeout = false;
  let hasConcurrency = false;
  let hasShard = false;
  let afterSeparator = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!afterSeparator && token === "--") {
      afterSeparator = true;
      continue;
    }
    if (afterSeparator || !token.startsWith("-")) {
      if (!token.endsWith(".test.mjs") || RESERVED_GLOB.test(token)) {
        invalid(`explicit files must be literal .test.mjs paths; expand globs in the shell: ${token}`);
      }
      explicit.push(path.resolve(repoRoot, token));
      continue;
    }

    const equal = token.indexOf("=");
    const name = equal === -1 ? token : token.slice(0, equal);
    const attached = equal === -1 ? null : token.slice(equal + 1);
    if (name === "--watch" || name.startsWith("--watch-") ||
        name === "--test-watch" || name.startsWith("--test-watch-")) {
      throw new TestRunnerOptionError(TEST_RUNNER_OPTION_CODES.UNSUPPORTED,
        `${name} requests continuous execution; use a finite test run`);
    }
    if (name === "--experimental-test-isolation" && attached === "none") {
      throw new TestRunnerOptionError(TEST_RUNNER_OPTION_CODES.UNSUPPORTED,
        "--experimental-test-isolation=none has no process-per-file boundary");
    }
    if (VALUE_OPTIONS.has(name)) {
      let value = attached;
      if (value === null) {
        value = tokens[index + 1];
        if (value === undefined || value.startsWith("-")) {
          invalid(`${name} requires a value; use ${name}=VALUE for a value beginning with -`);
        }
        index += 1;
      }
      if (value.length === 0) invalid(`${name} requires a nonempty value`);
      if (WRAPPER_OPTIONS.has(name)) {
        if (seenWrapper.has(name)) invalid(`${name} may appear only once`);
        seenWrapper.add(name);
        if (name === "--test-file-timeout") fileTimeoutMs = budget(value, name);
        else if (name === "--test-runner-phase-timeout") phaseTimeoutMs = budget(value, name);
        else if (name === "--test-artifacts-dir") artifactsDir = value;
        else {
          if (!DIAGNOSTIC_KINDS.has(value)) invalid(`${name} must be focused or baseline`);
          diagnosticKind = value;
        }
        if (name !== "--test-artifacts-dir") wrapperFlags.push(`${name}=${value}`);
        continue;
      }
      if (name === "--test-isolation" && value === "none") {
        throw new TestRunnerOptionError(TEST_RUNNER_OPTION_CODES.UNSUPPORTED,
          "--test-isolation=none has no process-per-file boundary");
      }
      if (name === "--test-reporter") reporterCount += 1;
      if (name === "--test-reporter-destination") destinationCount += 1;
      if (name === "--test-timeout") hasTimeout = true;
      if (name === "--test-concurrency") hasConcurrency = true;
      if (name === "--test-shard") hasShard = true;
      native.push(token, ...(attached === null ? [value] : []));
      continue;
    }
    if (VALUELESS_OPTIONS.has(name)) {
      if (attached !== null) invalid(`${name} does not take a value`);
      native.push(token);
      continue;
    }
    if (attached === null && tokens[index + 1] !== undefined &&
        !tokens[index + 1].startsWith("-") && tokens[index + 1] !== "--") {
      invalid(`${name} followed by a bare value is ambiguous; use ${name}=VALUE or -- before files`);
    }
    native.push(token);
  }
  if (reporterCount === 0 && destinationCount !== 0 ||
      reporterCount > 1 && reporterCount !== destinationCount ||
      reporterCount === 1 && destinationCount > 1) {
    invalid("--test-reporter and --test-reporter-destination counts must match for multiple reporters");
  }
  const targets = explicit.length > 0 ? explicit : selectedFiles.map((file) => path.resolve(repoRoot, file));
  const uniqueTargets = [...new Set(targets)];
  return Object.freeze({
    native, files: uniqueTargets, fileTimeoutMs, phaseTimeoutMs, artifactsDir, diagnosticKind,
    flags: Object.freeze([...wrapperFlags, ...native]),
    reporterCount, destinationCount, hasTimeout, hasConcurrency, hasShard
  });
}
