

import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import { TEST_RUNTIME_RUNNER_CATALOG } from "@agent-chassis/controlled-contract/test-proof";

import { DEPENDENCY_ECOSYSTEMS } from "../test-runtime-setup/ecosystems.mjs";
import { enclosingPackage } from "../test-runtime-setup/npm-workspace.mjs";
import { readinessRecovery } from "../test-runtime-setup/readiness.mjs";
import { resolveCurrentHarnessRuntime, resolveCurrentRunnerRuntime } from "./current-runtime.mjs";
import { DEPENDENCY_EXCLUSION_FAILED_CODE, DEPENDENCY_PROJECTION_CONFLICT_CODE, SELECTED_SOURCE_UNAVAILABLE_CODE,
  ensureNpmDependencyProjection, excludeNpmDependencyProjection } from "./dependency-projection.mjs";
import { SavedTestEntrypointsError, readSavedTestEntrypoints } from "../test-runtime-setup/test-entrypoints.mjs";
import { DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS, mintTestProofExecutionBudget } from "./confined-capture.mjs";
import { createExecutionRoot, executeConfinedInvocation } from "./confined-invocation.mjs";
import { resolveInstalledRunnerIntegration } from "./runner-integrations.mjs";
import { RunnerIntegrationPreconditionError } from "./runner-integrations/common.mjs";
import { configuredExecutableFailure } from "./runtime-inputs.mjs";
import { nativeTextFailureReport } from './native-text-failure-report.mjs';

export const ORDINARY_TEST_RUN_SCHEMA_VERSION = "ordinary-test-file-run.v1";
export const ORDINARY_TEST_RUN_CODES = Object.freeze({
  HARNESS_INVALID: "ordinary_test_harness_invalid",
  REQUEST_INVALID: "ordinary_test_request_invalid",
  TARGET_NO_MATCH: "ordinary_test_target_no_match",
  RUNNER_UNKNOWN: "ordinary_test_runner_unknown",
  TARGET_INVALID: "ordinary_test_target_invalid",
  TARGET_MISSING: "ordinary_test_target_missing",
  TARGET_NOT_FILE: "ordinary_test_target_not_file",
  TARGET_ESCAPES: "ordinary_test_target_escapes_checkout",
  SELECTOR_INVALID: "ordinary_test_selector_invalid",
  ENTRYPOINT_INVALID: "ordinary_test_entrypoint_invalid",
  SELECTION_UNSUPPORTED: "ordinary_test_selection_unsupported",
  SELECTION_UNRESOLVED: "ordinary_test_selection_unresolved"
});

const REQUEST_FIELDS = Object.freeze(["repositoryRoot", "checkoutRoot", "target", "runner", "harness", "environment",
  "selector", "timeoutMs", "budget"]);
const GLOB_CHARACTER = /[*?[\]{}]/u;
const SELECTOR_MAX_LENGTH = 1024;
const RUN_EVIDENCE_SCHEMA_VERSION = "ordinary-test-run.v1";

class OrdinaryRefusal extends Error {
  constructor(code, message, detail = {}, recovery = null) {
    super(message);
    this.code = code;
    this.detail = detail;
    this.recovery = recovery;
  }
}

const refuse = (code, message, detail, recovery) => { throw new OrdinaryRefusal(code, message, detail, recovery); };

export function ordinaryTargetDefect(value, { pattern = false } = {}) {
  if (typeof value !== "string" || value.length === 0) return "it is not a nonempty string";
  if (value.includes("\0")) return "it contains NUL";
  if (value.includes("\\")) return "it contains a backslash";
  if (value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return "it is not repository-relative";
  if (!pattern && GLOB_CHARACTER.test(value)) return "it contains a glob character";
  for (const segment of value.split("/")) {
    if (segment === "") return "it has an empty segment";
    if (segment === "." || segment === "..") return `it has a ${segment} segment`;
  }
  return null;
}

function checkoutFile(checkout, relative, codes) {
  const absolute = path.join(checkout, relative);
  let real;
  try {
    real = realpathSync(absolute);
  } catch (error) {
    refuse(codes.missing, `${relative} does not exist in the checkout`, { path: relative, errno: error?.code ?? null });
  }
  if (real !== checkout && !real.startsWith(`${checkout}/`)) {
    refuse(codes.escapes, `${relative} resolves outside the checkout`, { path: relative });
  }
  if (!lstatSync(real).isFile()) refuse(codes.notFile, `${relative} is not a regular file`, { path: relative });
  return real;
}

function absoluteRoot(value, name) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    refuse(ORDINARY_TEST_RUN_CODES.REQUEST_INVALID, `${name} must be an absolute launcher-resolved directory`,
      { field: name });
  }
  try {
    return realpathSync(value);
  } catch (error) {
    return refuse(ORDINARY_TEST_RUN_CODES.REQUEST_INVALID, `${name} cannot be resolved`,
      { field: name, errno: error?.code ?? null });
  }
}

function validateRequest(request, expandedLiteral) {
  const unknown = Object.keys(request ?? {}).filter((key) => !REQUEST_FIELDS.includes(key));
  if (request === null || typeof request !== "object" || unknown.length > 0) {
    refuse(ORDINARY_TEST_RUN_CODES.REQUEST_INVALID,
      "an ordinary test run accepts launcher-resolved roots, file/runner/selector or harness, environment, " +
      "and its timeout or budget",
      { unknown_fields: unknown, allowed_fields: REQUEST_FIELDS });
  }
  const { runner, environment = null, selector = null, timeoutMs = DEFAULT_TEST_PROOF_VALIDATION_TIMEOUT_MS,
    budget = null } = request;
  const repositoryRoot = absoluteRoot(request.repositoryRoot, "repositoryRoot");
  const checkoutRoot = absoluteRoot(request.checkoutRoot, "checkoutRoot");
  const harness = request.harness ?? null;
  if (harness !== null) {
    const bad = (message) => refuse(ORDINARY_TEST_RUN_CODES.HARNESS_INVALID, message, { field: "harness" });
    if (typeof harness !== "object" || Array.isArray(harness) ||
        Object.keys(harness).some((key) => !["cwd", "argv"].includes(key))) bad("harness accepts only cwd and argv");
    if (["target", "runner", "selector"].some((key) => request[key] !== undefined && request[key] !== null)) {
      bad("harness is mutually exclusive with file, runner and selector");
    }
    const defect = harness.cwd === "." ? null : ordinaryTargetDefect(harness.cwd, { pattern: true });
    if (defect !== null) bad(`harness.cwd must be a repository-relative directory: ${defect}`);
    if (!Array.isArray(harness.argv) || harness.argv.length === 0 || harness.argv.length > 1024 ||
        harness.argv.some((arg) => typeof arg !== "string" || arg.includes("\0") || arg.length > 32768) ||
        harness.argv[0].length === 0) bad("harness.argv must name an executable followed by literal arguments");
  }
  const defect = harness === null ? ordinaryTargetDefect(request.target, { pattern: expandedLiteral }) : null;
  if (defect !== null) {
    refuse(ORDINARY_TEST_RUN_CODES.TARGET_INVALID, `the target must be one literal repository-relative file: ${defect}`,
      { target: typeof request.target === "string" ? request.target : null });
  }
  const descriptor = TEST_RUNTIME_RUNNER_CATALOG.runners.find(({ name }) => name === runner) ?? null;
  if (harness === null && descriptor === null) {
    refuse(ORDINARY_TEST_RUN_CODES.RUNNER_UNKNOWN, `${JSON.stringify(runner)} is not a runtime runner`,
      { runner: typeof runner === "string" ? runner : null,
        runners: TEST_RUNTIME_RUNNER_CATALOG.runners.map(({ name }) => name) });
  }
  if (environment !== null && (typeof environment !== "string" || environment.length === 0)) {
    refuse(ORDINARY_TEST_RUN_CODES.REQUEST_INVALID, "environment must be a published environment ID",
      { field: "environment" });
  }
  if (selector !== null && (typeof selector !== "string" || selector.length === 0 ||
      selector.length > SELECTOR_MAX_LENGTH || /[\0\r\n]/u.test(selector) || selector.startsWith("-"))) {
    refuse(ORDINARY_TEST_RUN_CODES.SELECTOR_INVALID, "a native selector is one nonempty line of at most " +
      `${SELECTOR_MAX_LENGTH} characters that does not begin with -`, { field: "selector" });
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    refuse(ORDINARY_TEST_RUN_CODES.REQUEST_INVALID, "timeoutMs must be a positive integer", { field: "timeoutMs" });
  }
  return { repositoryRoot, checkoutRoot, target: request.target, harness, descriptor, environment, selector, timeoutMs,
    budget };
}

const PROOF_STAGES = new WeakSet();
const COMPILER_CACHE_UNAVAILABLE_CODES = Object.freeze(["test_proof_native_compiler_cache_unavailable",
  "test_proof_native_compiler_cache_not_excluded"]);

export function mintProofStage({ compilerCache = null, compose }) {
  if (typeof compose !== "function") throw new TypeError("a proof stage requires its compose function");
  const stage = Object.freeze({ compilerCache, compose });
  PROOF_STAGES.add(stage);
  return stage;
}

export async function resolveTestFileRuntime({ repositoryRoot, checkoutRoot, target, descriptor, environment = null,
  compilerCache = null, executionRoot = null, hostPath = undefined }) {
  const resolve = async (caching) => {
    const { located, runtime } = await resolveCurrentRunnerRuntime({ repositoryRoot, checkoutRoot, target,
      runner: descriptor, environment, compilerCache: caching,
      ...(executionRoot === null ? {} : { scratchRoot: executionRoot.scratch, hostPath }) });
    if (!located.configured) {
      return { ok: false, kind: "unrouted", code: "test_runtime_runner_not_prepared",
        message: `no ${descriptor.dependency_ecosystem} project in this checkout owns ${target}`,
        detail: { runner: descriptor.runner_id, target }, route: null,
        recovery: readinessRecovery(`No ${descriptor.dependency_ecosystem} installation root contains ${target}: ` +
          "neither a published environment nor a project manifest in the checkout. Declare the project that " +
          "contains it.") };
    }
    if (!located.ok) {
      return { ok: false, kind: "route", code: located.failure.code, message: located.failure.message,
        detail: located.failure.detail ?? {}, recovery: located.failure.recovery ?? null, route: null };
    }
    if (!runtime.ok) {
      return { ok: false, kind: "runtime", code: runtime.code,
        message: runtime.message ?? `the configured ${descriptor.name} runtime is not usable`,
        detail: runtime.detail ?? {}, recovery: runtime.recovery ?? null, route: located.route };
    }
    return { ok: true, project: located.project, route: located.route, runtime };
  };
  const resolved = await resolve(compilerCache !== null);
  if (!resolved.ok || compilerCache === null) {
    return resolved.ok ? { ...resolved, cache: { directory: null, choice: "none" } } : resolved;
  }
  try {
    return { ...resolved, cache: { directory: compilerCache.open(resolved.runtime), choice: "persistent" } };
  } catch (error) {
    if (!COMPILER_CACHE_UNAVAILABLE_CODES.includes(error?.code)) throw error;
    const scratch = await resolve(false);
    return scratch.ok ? { ...scratch, cache: { directory: null, choice: "attempt_scratch", reason: error.code } }
      : scratch;
  }
}

async function currentRuntime(validated, stage, executionRoot = null) {
  let resolved;
  if (validated.harness === null) {
    resolved = await resolveTestFileRuntime({ ...validated, compilerCache: stage?.compilerCache ?? null,
      executionRoot, hostPath: executionRoot === null ? undefined : process.env.PATH ?? null });
  } else {
    const { located, runtime } = await resolveCurrentHarnessRuntime({ ...validated,
      scratchRoot: executionRoot.scratch, hostPath: process.env.PATH ?? null });
    resolved = !located.ok ? { ok: false, kind: "route", ...located.failure }
      : !runtime.ok ? { ...runtime, kind: "runtime", route: located.route }
        : { ok: true, project: located.project, route: located.route, runtime,
          cache: { directory: null, choice: "none" } };
  }
  if (!resolved.ok) {
    refuse(resolved.code, resolved.message, resolved.kind === "runtime"
      ? { ...resolved.detail, route: resolved.route } : resolved.detail, resolved.recovery);
  }
  return resolved;
}

function provisionInvocationDependencies(runtime, { checkoutRoot, invocationCheckout, invocationProjectDir, file }) {
  if (runtime.preparation?.ecosystem !== "npm" || runtime.preparation.status !== "present") return runtime;
  const exclude = (projection) => {
    if (invocationCheckout === checkoutRoot) excludeNpmDependencyProjection({ checkoutRoot, projection });
  };
  let projection;
  try {
    projection = ensureNpmDependencyProjection({ dependency: runtime.preparation,
      projectHostDir: invocationProjectDir });
  } catch (error) {
    if ((error?.published ?? []).length > 0) exclude({ trees: error.published });
    throw error;
  }
  exclude(projection);
  return Object.freeze({ ...runtime, values: Object.freeze({ ...DEPENDENCY_ECOSYSTEMS.npm.runtimeBinding({
    dependency: runtime.preparation, projectHostDir: invocationProjectDir }).values,
  package_context: enclosingPackage(runtime.environment?.members ?? [], file) }) });
}

function observerConfigWrite({ path: file, value }, runnerPackage) {
  return { path: file,
    content: `${JSON.stringify(runnerPackage === null ? value : { ...value, runner_package: runnerPackage })}\n` };
}

function savedAssociations(checkoutRoot, descriptor, project) {
  let saved;
  try {
    saved = readSavedTestEntrypoints(checkoutRoot);
  } catch (error) {
    if (!(error instanceof SavedTestEntrypointsError)) throw error;
    return refuse(error.code, error.message, error.detail);
  }
  const associations = saved.filter((entry) => entry.runner === descriptor.name && entry.project === project);
  for (const { entrypoint } of associations) {
    checkoutFile(checkoutRoot, entrypoint, { missing: ORDINARY_TEST_RUN_CODES.ENTRYPOINT_INVALID,
      escapes: ORDINARY_TEST_RUN_CODES.ENTRYPOINT_INVALID, notFile: ORDINARY_TEST_RUN_CODES.ENTRYPOINT_INVALID });
  }
  return Object.freeze(associations);
}

const DIAGNOSTIC_EXCERPT_MAX_BYTES = 256;

const ERROR_STATEMENT = /\b[A-Za-z_$.]*(?:Error|Exception)(?: \[[A-Z0-9_]+\])?:/u;
const FAILED_RESULT_LINE = /[✘✗✖✕]|\bFAIL(?:ED)?\b/u;
const ERROR_LINE_WORD =
  /(?:^|[\s:])[A-Za-z_$.]*(?:Error|Exception)\s*$|\berror(?=[:[])|\bpanic(?:ked)?\b|\bfatal\b/u;
const PASSING_LINE = /^\s*(?:[✔✓√]|ok\b|PASS(?:ED)?\b|--- PASS\b)|\bPASSED(?:\s+\[[^\]]*\])?\s*$|\.\.\. ok\s*$/u;

const NO_WORD_LINE = /^[^\p{L}\p{N}]*$/u;

function* linesFrom(text, from = 0) {
  for (let start = from; start < text.length;) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline;

    yield { start, nextStart: end + 1, line: stripVTControlCharacters(text.slice(start, end)) };
    start = end + 1;
  }
}

function firstErrorLine(text, results) {

  if (results[0]?.substantive === true) return failedResultStart(text, results[0], results);
  let fallback = null;
  let listing = false;
  let listed = false;
  for (const { start, line } of linesFrom(text)) {
    const passing = PASSING_LINE.test(line);
    const failed = !passing && FAILED_RESULT_LINE.test(line);
    if (!passing && ERROR_STATEMENT.test(line)) return start;
    if (fallback === null) {
      if (failed || (!passing && ERROR_LINE_WORD.test(line))) fallback = start;
      listing = failed;
    } else if (listing) {
      if (passing || failed) listed = true;
      else if (!NO_WORD_LINE.test(line)) {
        if (listed) return start;
        listing = false;
      }
    }
  }
  return fallback;
}

const failedResult = (line) => !PASSING_LINE.test(line) && FAILED_RESULT_LINE.test(line) &&
  !/^\s*FAIL(?:ED)?\s*$/u.test(line) && !/:\s*$/u.test(line) &&
  !/^\s*(?:FAIL|FAILED)\s*\|/u.test(line) &&
  !/^\s*[✘✗✖✕]\s+\d+\s+problems?\b/u.test(line);
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

const resultLine = (line) => PASSING_LINE.test(line) || FAILED_RESULT_LINE.test(line);

const TYPESCRIPT_DIAGNOSTIC = /^[^\s"'`][^"'`\r\n]*\(\d+,\d+\):\s+error TS\d+:/u;
const GO_DIAGNOSTIC = /^[^\s"'`]+\.go:\d+:\d+:\s+\S/u;
const ESLINT_ROW = /^\s+\d+:\d+\s+(error|warning)\s+\S/u;
const FILE_HEADER = /^[^\s"'`][^"'`\r\n]*\.[^\s./\\]+\s*$/u;
const COLLECTION_HEADER = /^_+ ERROR collecting .+ _+\s*$/u;
const COLLECTION_END = /^(?:=+\s+.+\s+=+\s*$|!+ Interrupted:)/u;
const AGGREGATE_RESULT = /^(?:FAIL\s+.+\s+\[build failed\]\s*$|test result: FAILED\.)/u;

function failedResultLines(text) {
  const report = nativeTextFailureReport(text);
  if (report !== null) return report.failures.map(row => ({ start: row.start, nextStart: row.start,
    end: row.end, line: row.name, listed: false, substantive: true,
    ...(row.context === undefined ? {} : { context: row.context }) }));
  const seen = new Set();
  const lines = [];
  const diagnostics = [];
  let file = null;
  let collection = null;
  let previous = null;
  for (const entry of linesFrom(text)) {
    const rawLine = () => text.slice(entry.start, Math.min(entry.nextStart, text.length)).replace(/\r?\n$/u, "");
    if (COLLECTION_HEADER.test(entry.line)) {
      if (collection !== null) collection.end = entry.start;
      collection = { ...entry, context: rawLine(), substantive: true };
      diagnostics.push(collection);
      file = null;
      continue;
    }
    if (COLLECTION_END.test(entry.line)) {
      if (collection !== null) collection.end = entry.start;
      collection = null;
    }
    if (collection !== null) {

      if (/^E\s+/u.test(entry.line) && ERROR_STATEMENT.test(entry.line) && collection.errorStart === undefined) {
        collection.start = entry.start;
        collection.errorStart = entry.start;
      }
      continue;
    }
    if (!PASSING_LINE.test(entry.line) && (TYPESCRIPT_DIAGNOSTIC.test(entry.line) || GO_DIAGNOSTIC.test(entry.line))) {
      diagnostics.push({ ...entry, end: entry.nextStart, substantive: true });
      file = null;
      continue;
    }
    const lint = file === null ? null : ESLINT_ROW.exec(entry.line);
    if (lint !== null) {
      diagnostics.push({ ...entry, end: entry.nextStart, substantive: true, context: file, warning: lint[1] === "warning" });
      continue;
    }
    if (!NO_WORD_LINE.test(entry.line)) file = !PASSING_LINE.test(entry.line) && FILE_HEADER.test(entry.line) ? rawLine() : null;
    if (NO_WORD_LINE.test(entry.line)) continue;
    const result = resultLine(entry.line);
    if (result && previous?.failed !== undefined) previous.failed.listed = true;
    let failed;
    if (failedResult(entry.line) && !seen.has(entry.line.trim())) {
      seen.add(entry.line.trim());
      failed = { ...entry, listed: previous?.result === true };
      lines.push(failed);
    }
    previous = { result, failed };
  }

  return diagnostics.length === 0 ? lines : [...diagnostics,
    ...lines.filter(entry => !AGGREGATE_RESULT.test(entry.line)).map(entry => ({ ...entry, substantive: true }))]
    .sort((a, b) => Number(a.warning === true) - Number(b.warning === true) || a.start - b.start);
}

const headingWords = (line) => line.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
function namePosition(line, words) {
  const at = words.length < 3 ? -1 : line.indexOf(words);
  return at < 0 || WORD_CHARACTER.test(line.slice(0, at).slice(-1)) ||
    WORD_CHARACTER.test(line.slice(at + words.length, at + words.length + 1)) ? -1 : at;
}

function failedResultStart(text, { start, nextStart, line, listed }, results) {
  if (!listed) return start;
  let named = null;
  let past = false;
  for (const next of linesFrom(text, nextStart)) {

    if (resultLine(next.line) && next.line.trim() !== line.trim()) continue;
    if (!past && NO_WORD_LINE.test(next.line)) continue;
    past = true;
    const words = headingWords(next.line);
    const at = namePosition(line, words);
    if (at < 0) continue;
    let useful = false;
    for (const following of linesFrom(text, next.nextStart)) {
      if (NO_WORD_LINE.test(following.line)) continue;
      useful = !resultLine(following.line) &&
        !results.some((result) => namePosition(result.line, headingWords(following.line)) >= 0);
      break;
    }
    if (!useful) continue;
    if (named === null || at < named.at || (at === named.at && words.length > named.words.length)) {
      named = { at, words, start: next.start };
    }
  }
  return named?.start ?? start;
}

export function ordinaryFailedResultDiagnostic(text, { failure = null, maxBytes = DIAGNOSTIC_EXCERPT_MAX_BYTES } = {}) {
  const lines = failedResultLines(text);
  if (failure === null || failure > lines.length) return Object.freeze({ failures: lines.length });
  const start = failedResultStart(text, lines[failure - 1], lines);
  return Object.freeze({ failures: lines.length, failure,
    ...(lines[failure - 1].context === undefined ? {} : { context: lines[failure - 1].context }),
    offset: Buffer.byteLength(text.slice(0, start), "utf8"),
    text: utf8Bounded(text.slice(start, lines[failure - 1].end), maxBytes, false), total_bytes: Buffer.byteLength(text, "utf8") });
}

function utf8Bounded(text, limit, fromEnd) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= limit) return text;
  let cut = fromEnd ? bytes.length - limit : limit;
  while (cut > 0 && cut < bytes.length && (bytes[cut] & 0xc0) === 0x80) cut += fromEnd ? 1 : -1;
  return (fromEnd ? bytes.subarray(cut) : bytes.subarray(0, cut)).toString("utf8");
}

function captureExcerpt(text, maxBytes) {
  const total = Buffer.byteLength(text, "utf8");
  const results = failedResultLines(text);
  const start = firstErrorLine(text, results);
  if (start !== null) {
    return { basis: "first_error_line", selectable: results.length > 0,
      warning: results[0]?.warning === true, offset: Buffer.byteLength(text.slice(0, start), "utf8"),
      ...(results[0]?.substantive === true ? { substantive: true,
        ...(results[0].context === undefined ? {} : { context: results[0].context }) } : {}),
      text: utf8Bounded(text.slice(start, results[0]?.substantive === true ? results[0].end : undefined), maxBytes, false),
      total_bytes: total };
  }
  if (total <= maxBytes) return { basis: "whole", offset: 0, text, total_bytes: total };
  const tail = utf8Bounded(text, maxBytes, true);
  return { basis: "tail", offset: total - Buffer.byteLength(tail, "utf8"), text: tail, total_bytes: total };
}

export function ordinaryRunDiagnostic(run, { maxBytes = DIAGNOSTIC_EXCERPT_MAX_BYTES } = {}) {
  if (run.ran === false) {
    for (const source of ["blocker_message", "spawn_error"]) {
      const text = run[source];
      if (typeof text === "string" && text.length > 0) {
        return Object.freeze({ source, basis: "whole", offset: 0, text,
          total_bytes: Buffer.byteLength(text, "utf8") });
      }
    }
  }
  const captured = ["stderr", "stdout"].filter((source) => typeof run[source] === "string" && run[source].length > 0)
    .map((source) => ({ source, ...captureExcerpt(run[source], maxBytes) }));
  const substantive = captured.filter(entry => entry.substantive === true);

  const chosen = substantive.find(entry => !entry.warning) ??
    (substantive.length === 0 ? undefined : captured.find(entry => entry.selectable && !entry.warning) ?? substantive[0]) ??
    captured.find(({ basis }) => basis === "first_error_line") ?? captured[0];
  if (chosen === undefined) return null;
  const { substantive: preferred, selectable, warning, ...diagnostic } = chosen;
  return Object.freeze(diagnostic);
}

const REQUEST_REFUSAL_CODES = new Set(Object.values(ORDINARY_TEST_RUN_CODES));
const REQUEST_FIELDS_CORRECTABLE = Object.freeze(["file", "runner", "environment", "selector"]);

export function ordinaryRequestCorrection(result) {
  if (result?.status !== "refused" && result?.status !== "selection_unresolved") return null;
  const detail = result.detail ?? {};
  if (detail.reason === "selection_command_unsuccessful") return null;
  if (Array.isArray(detail.valid_choices)) {
    return Object.freeze({ fields: Object.freeze(["environment"]), set: "environment",
      rejected: typeof detail.requested_environment === "string" ? detail.requested_environment : null,
      choices: Object.freeze([...detail.valid_choices]) });
  }
  if (result.code === "test_runtime_runner_not_prepared") {
    return Object.freeze({ fields: Object.freeze(["file", "runner"]) });
  }
  if (result.code === ORDINARY_TEST_RUN_CODES.HARNESS_INVALID) {
    return Object.freeze({ fields: Object.freeze(["harness"]) });
  }
  if (!REQUEST_REFUSAL_CODES.has(result.code)) return null;
  if (result.code === ORDINARY_TEST_RUN_CODES.RUNNER_UNKNOWN && Array.isArray(detail.runners)) {
    return Object.freeze({ fields: REQUEST_FIELDS_CORRECTABLE, set: "runner",
      rejected: typeof detail.runner === "string" ? detail.runner : null,
      choices: Object.freeze([...detail.runners]) });
  }
  return Object.freeze({ fields: REQUEST_FIELDS_CORRECTABLE });
}

class SelectionUnresolved extends Error {
  constructor(run) {
    super("the runner's own selection command did not complete successfully");
    this.code = ORDINARY_TEST_RUN_CODES.SELECTION_UNRESOLVED;
    this.detail = Object.freeze({ reason: "selection_command_unsuccessful", phase: "selection",
      disposition: run.disposition,
      ran: run.ran, exit_code: run.exit_code, timed_out: run.timed_out, cancelled: run.cancelled,
      output_truncated: run.output_truncated === true, blocker_code: run.blocker_code ?? null,
      diagnostic: ordinaryRunDiagnostic(run) ?? Object.freeze({ source: "none" }) });
  }
}

function selectionUnresolved(error, resolution) {
  return Object.freeze({ schema_version: ORDINARY_TEST_RUN_SCHEMA_VERSION, status: "selection_unresolved",
    ok: false, proof_credit: false, code: ORDINARY_TEST_RUN_CODES.SELECTION_UNRESOLVED, message: error.message,
    detail: error.detail ?? {}, resolution });
}

function refusal(error, extra = {}) {
  return Object.freeze({ schema_version: ORDINARY_TEST_RUN_SCHEMA_VERSION, status: "refused", ok: false,
    proof_credit: false, code: error.code, message: error.message, detail: error.detail ?? {},
    recovery: error.recovery ?? null, ...extra });
}

export function runOrdinaryTestFile(request, started = null) {
  return runTestFile(request, null, started);
}

export function runProofStageTestFile(request, stage) {
  if (!PROOF_STAGES.has(stage)) {
    throw Object.assign(new Error("a proof stage contribution must be launcher-minted"),
      { code: "test_proof_stage_untrusted" });
  }
  return runTestFile(request, stage, null);
}

async function runTestFile(request, stage, started) {
  const executionRoot = createExecutionRoot();
  let result;
  let thrown = null;
  try {
    result = await runTestFileWithRoot(request, stage, executionRoot, started);
  } catch (error) {
    thrown = error;
  }
  const cleanup = executionRoot.release();
  if (cleanup.status === "failed") {
    if (thrown !== null) throw new AggregateError([thrown, executionRoot.removalError],
      "test invocation failed and its owned execution root could not be removed", { cause: thrown });
    const run = result?.run ?? null;
    const cleanupRecovery = Object.freeze({ scope: "owned_execution_root", execution_root: executionRoot.root,
        original_cause: Object.freeze({ ran: run?.ran ?? false, exit_code: run?.exit_code ?? null,
          blocker_code: run?.blocker_code ?? result?.code ?? null }),
        uncertainty: "execution-root removal was not confirmed",
        next_action: `Inspect execution root ${executionRoot.root} and remove it after confirming no owned process can use it`,
        actor: "host operator" });
    const cleanupFacts = { cleanup_failed: true, cleanup_scope: "owned_execution_root",
      cleanup_error: `execution_root_removal_${cleanup.errno ?? "failed"}`,
      cleanup_recovery: cleanupRecovery };
    return Object.freeze({ ...result, ...cleanupFacts,
      ...(run === null ? {} : { run: Object.freeze({ ...run, ...cleanupFacts }) }) });
  }
  if (thrown !== null) throw thrown;
  return result;
}

async function runTestFileWithRoot(request, stage, executionRoot, started) {
  let validated;
  let associations;
  let prepared;
  try {

    validated = validateRequest(request, started !== null);
    const { checkoutRoot, target, descriptor } = validated;
    if (validated.harness === null) {
      validated.absoluteFile = checkoutFile(checkoutRoot, target, { missing: ORDINARY_TEST_RUN_CODES.TARGET_MISSING,
        escapes: ORDINARY_TEST_RUN_CODES.TARGET_ESCAPES, notFile: ORDINARY_TEST_RUN_CODES.TARGET_NOT_FILE });
    } else {
      const relative = validated.harness.cwd;
      let directory;
      try { directory = realpathSync(path.join(checkoutRoot, relative)); }
      catch (error) { refuse(ORDINARY_TEST_RUN_CODES.HARNESS_INVALID,
        `harness.cwd ${relative} cannot be resolved`, { field: "harness", errno: error.code }); }
      if (directory !== checkoutRoot && !directory.startsWith(`${checkoutRoot}/`)) {
        refuse(ORDINARY_TEST_RUN_CODES.HARNESS_INVALID, `harness.cwd ${relative} resolves outside the checkout`,
          { field: "harness" });
      }
      if (!lstatSync(directory).isDirectory()) refuse(ORDINARY_TEST_RUN_CODES.HARNESS_INVALID,
        `harness.cwd ${relative} is not a directory`, { field: "harness" });
      validated.commandDirectory = directory;
    }
    prepared = await currentRuntime(validated, stage, executionRoot);
    associations = validated.harness === null ? savedAssociations(checkoutRoot, descriptor, prepared.project) : [];
  } catch (error) {
    if (error instanceof OrdinaryRefusal) return refusal(error);
    throw error;
  }
  const { checkoutRoot, target, descriptor, selector, timeoutMs } = validated;
  const { project, route, cache } = prepared;
  let { runtime } = prepared;
  const ownedBudget = validated.budget === null ? mintTestProofExecutionBudget({ timeoutMs }) : null;
  const budget = validated.budget ?? ownedBudget;
  const resolution = [];
  const baseEvidence = (phase) => ({ schema_version: RUN_EVIDENCE_SCHEMA_VERSION, operation: "ordinary_test",
    phase, ...(validated.harness === null ? { target, runner: descriptor.runner_id, raw_exec_enabled: false }
      : { harness: validated.harness }) });

  const projectDir = project === "." ? checkoutRoot : path.join(checkoutRoot, project);
  let contribution = null;

  let runnerPackage = null;

  const staged = (invocation, phase) => {
    const additions = contribution?.additions ?? {};
    const writes = [...(additions.observerConfig === undefined ? []
      : [observerConfigWrite(additions.observerConfig, runnerPackage)]), ...(additions.writes ?? [])];
    return {
      ...invocation,
      env: { ...(invocation.env ?? {}), ...(additions.env ?? {}) },
      directories: [...(additions.directories ?? []), ...(invocation.directories ?? []), ...runtime.directories],
      readOnlyBinds: [...(invocation.readOnlyBinds ?? []), ...(additions.readOnlyBinds ?? [])],
      executionRoot,
      sourceRoot: contribution?.additions?.copyRoot ?? checkoutRoot,
      ...(writes.length === 0 ? {} : { writes }),
      ...(phase === "run" && additions.channel !== undefined ? { channel: additions.channel } : {}),
      ...(cache.directory === null ? {} : { writableCache: cache.directory })
    };
  };

  const execute = (invocation, phase) => {
    const unavailable = configuredExecutableFailure(runtime, invocation.command);
    if (unavailable !== null) {
      throw new OrdinaryRefusal(unavailable.code, unavailable.message, { ...unavailable.detail, route },
        unavailable.recovery);
    }
    const confined = (owned) => executeConfinedInvocation({ checkout: checkoutRoot, runtime, invocation: owned,
      timeoutMs, budget, baseEvidence: baseEvidence(phase),
      ...(phase === "run" && contribution !== null ? { nativeReport: contribution.nativeReport ?? null,
        observe: contribution.observe ?? null } : {}) });
    return confined(staged(invocation, phase));
  };

  const metadata = async (invocation) => {
    const run = await execute(invocation, "selection");
    resolution.push(Object.freeze({ invocation: Object.freeze({ command: invocation.command,
      args: Object.freeze([...invocation.args]), cwd: invocation.cwd }), run }));
    if (run.ok !== true || run.output_truncated === true) throw new SelectionUnresolved(run);
    return run;
  };
  try {
    const subject = validated.harness?.cwd ?? target;
    const file = project === "." ? subject : path.posix.relative(project, subject);
    if (stage !== null) {
      contribution = await stage.compose({ runtime, project, route, cache, checkout: checkoutRoot, projectDir,
        executionRoot,
        target, file, entrypoints: associations });
    }
    const invocationCheckout = contribution?.additions?.copyRoot ?? checkoutRoot;
    const invocationProjectDir = project === "." ? invocationCheckout : path.join(invocationCheckout, project);
    const invocationAbsoluteFile = validated.harness === null ? path.join(invocationCheckout, target) : null;
    try {
      runtime = provisionInvocationDependencies(runtime, { checkoutRoot, invocationCheckout,
        invocationProjectDir, file });
    } catch (error) {
      if (![DEPENDENCY_PROJECTION_CONFLICT_CODE, SELECTED_SOURCE_UNAVAILABLE_CODE,
        DEPENDENCY_EXCLUSION_FAILED_CODE].includes(error?.code)) throw error;
      return refusal(new OrdinaryRefusal(error.code, error.message, { ...error.detail, route }),
        { resolution: Object.freeze(resolution) });
    }
    let plan;
    try {
      plan = validated.harness !== null ? {
        invocation: { command: validated.harness.argv[0], args: validated.harness.argv.slice(1),
          cwd: validated.commandDirectory },
        harness: { kind: "repository_command", specification: validated.harness },
        selection: { owner: "repository_harness", exact: "not_inferred" }
      } : await resolveInstalledRunnerIntegration(descriptor).ordinaryInvocation({ runtime,
        repositoryRoot: validated.repositoryRoot,
        checkout: invocationCheckout, projectDir: invocationProjectDir, project, target,
        absoluteFile: invocationAbsoluteFile, file, selector,
        entrypoints: associations, metadata, proof: contribution?.proof ?? null });
    } catch (error) {
      if (error instanceof SelectionUnresolved || (error instanceof RunnerIntegrationPreconditionError &&
          error.code === ORDINARY_TEST_RUN_CODES.SELECTION_UNRESOLVED)) {
        return selectionUnresolved(error, Object.freeze(resolution));
      }
      if (error instanceof RunnerIntegrationPreconditionError || error instanceof OrdinaryRefusal) {
        return refusal(error, { resolution: Object.freeze(resolution) });
      }
      throw error;
    }
    const { invocation, harness, selection = {} } = plan;
    runnerPackage = plan.runnerPackage ?? null;
    if (started !== null) {
      const command = JSON.stringify([invocation.command, invocation.args, invocation.cwd]);
      if (started.has(command)) {
        return Object.freeze({ schema_version: ORDINARY_TEST_RUN_SCHEMA_VERSION, status: "covered", ok: false,
          proof_credit: false, covered_by: started.get(command), resolution: Object.freeze(resolution) });
      }
      started.set(command, target);
    }
    let run;
    try {
      run = await execute(invocation, "run");
    } catch (error) {
      if (error instanceof OrdinaryRefusal) return refusal(error, { resolution: Object.freeze(resolution) });
      throw error;
    }
    return Object.freeze({
      schema_version: ORDINARY_TEST_RUN_SCHEMA_VERSION,
      status: run.ran === true ? "executed" : run.completion?.confirmed === false ? "unconfirmed" : "not_run",
      ok: run.ok === true,
      proof_credit: false,
      run,
      resolution: Object.freeze(resolution),
      identity: Object.freeze({
        ...(validated.harness === null ? { runner: descriptor.name, runner_id: descriptor.runner_id, target, selector }
          : { command_harness: validated.harness }),
        project,
        environment: runtime.identity.environment,
        route,
        readiness_digest: runtime.identity.readiness_digest,
        ...(runtime.identity.configuration_record_status === undefined ? {}
          : { configuration_record_status: runtime.identity.configuration_record_status }),
        toolchains: runtime.identity.toolchains,
        dependencies: runtime.identity.dependencies,
        harness,
        selection: Object.freeze({ ...selection }),
        invocation: Object.freeze({ command: invocation.command, args: Object.freeze([...invocation.args]),
          cwd: invocation.cwd })
      })
    });
  } finally {
    ownedBudget?.dispose();
  }
}
