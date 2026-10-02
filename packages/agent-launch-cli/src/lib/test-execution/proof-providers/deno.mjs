

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import integration from "../runner-integrations/deno.mjs";
import { nativeRecordFailureDiagnostic } from "../../workspace-agent-test-proof-error-diagnostic.mjs";
import { DIAGNOSTIC_GRAPH_ASSET, JAVASCRIPT_INSTRUMENTATION_ASSET, JSON_TITLE_PATH,
  instrumentJavaScriptAttempt, javascriptLayout } from "./javascript-support.mjs";
import { nativeProviderImplementation } from "./native-lifecycle.mjs";

const SPEC_ASSET = fileURLToPath(import.meta.url);

const MAX_CHECK_ERRORS = 16;

const SGR_RE = /\u001b\[[0-9;]*m/gu;
const CHECK_HEADER_RE = /^(TS\d+) \[ERROR\]: (.+)$/u;
const CHECK_LOCATION_RE = /^ {4}at (file:\S+):(\d+):(\d+)$/u;
const CHECK_COUNT_RE = /^Found (\d+) errors\.$/u;
const CHECK_FAILED = "error: Type checking failed.";
const CARET_RE = /^\s*[~^][~^\s]*$/u;

function continues(lines) {
  const body = lines.filter((line) => line.trim() !== "");
  return (body.length >= 2 && CARET_RE.test(body.at(-1)) ? body.slice(0, -2) : body).length > 0;
}

function checkLocation(specifier, line, column, { workRoot, instrumented }) {
  let file;
  try { file = fileURLToPath(specifier); } catch { return undefined; }
  const relative = path.relative(workRoot, file);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
  const repositoryPath = relative.split(path.sep).join("/");
  return { file: repositoryPath, line: Number(line),
    ...(repositoryPath === instrumented ? {} : { column: Number(column) }) };
}

export function denoTestReport({ workRoot, instrumented = null }) {
  const records = [];
  const issues = [];
  let pending = null;
  let seen = 0;
  let found = null;
  let failed = false;
  let output = false;
  const close = () => {
    if (pending === null) return;
    const { lines, ...record } = pending;
    if (continues(lines)) {
      issues.push({ path: `/native_report/${seen - 1}/message`, reason: "native_report_unreadable" });
    }
    if (records.length < MAX_CHECK_ERRORS) records.push(record);
    pending = null;
  };
  return {
    stream: "stderr",
    line(raw) {
      if (failed) return;
      const text = raw.replace(SGR_RE, "");
      if (text.trim() !== "") output = true;
      const header = CHECK_HEADER_RE.exec(text);
      if (header !== null) {
        close();
        seen += 1;
        pending = { name: "error", code: header[1], message: header[2], lines: [] };
        return;
      }
      const at = pending === null || pending.location !== undefined ? null : CHECK_LOCATION_RE.exec(text);
      if (at !== null) {
        const location = checkLocation(at[1], at[2], at[3], { workRoot, instrumented });
        pending = { ...pending, location: location ?? null };
        return;
      }
      const count = CHECK_COUNT_RE.exec(text);
      if (count !== null) found = Number(count[1]);
      else if (text === CHECK_FAILED) {
        close();
        failed = true;
      } else if (pending !== null && pending.location === undefined) pending.lines.push(text);
    },
    finish() {
      close();
      if (!failed && seen === 0 && !output) return { build_failure: null };

      if (!failed || seen === 0 || (found !== null && found > seen)) {
        issues.push({ path: "/native_report", reason: "native_report_unreadable" });
      }
      if (seen > records.length) issues.push({ path: "/native_report", reason: "capture_budget_exceeded" });
      return { build_failure: nativeRecordFailureDiagnostic({ issues,
        records: records.map(({ location, ...record }) => (location ? { ...record, location } : record)) }) };
    }
  };
}

function observerSource(config) {
  return `// Launcher Deno test-proof observer (generated per attempt).
import diagnosticGraph from ${JSON.stringify(pathToFileURL(DIAGNOSTIC_GRAPH_ASSET).href)};
const CONFIG = ${JSON.stringify(config)};
const encoder = new TextEncoder();
const channel = Deno.openSync(CONFIG.channel, { write: true, append: true });
const source = "deno." + Deno.pid + "." + crypto.randomUUID().slice(0, 8);
let sequence = 0;
function emit(kind, fields = {}) {
  const bytes = encoder.encode(JSON.stringify({ v: 1, nonce: CONFIG.nonce, src: source,
    seq: sequence, kind, ...fields }) + "\\n");
  let offset = 0;
  while (offset < bytes.length) offset += channel.writeSync(bytes.subarray(offset));
  sequence += 1;
}
function captured(error, origin) {
  try {
    return diagnosticGraph.captureTestFailureDiagnostic(error, { origin });
  } catch {
    return diagnosticGraph.unavailableTestFailureDiagnostic(
      [{ path: "/error", reason: "source_value_unreadable" }], { origin });
  }
}
// One failure: the thrown error, with the failed step that raised it or that
// Deno failed without an exception (then no error was supplied).
function diagnostic(failure) {
  const origin = failure.step === null ? undefined
    : { kind: "step", ...(typeof failure.step === "string" && failure.step.length > 0
      ? { name: failure.step } : {}) };
  return failure.threw ? captured(failure.error, origin)
    : diagnosticGraph.unavailableTestFailureDiagnostic(undefined, { origin });
}
// The selected test module, loaded by the entry. A module that cannot be
// imported or evaluated ends the session with its original error as the one
// runner-level error, and Deno still fails the run with it.
export async function loadSelectedModule(load) {
  try {
    return await load();
  } catch (caught) {
    emit("session_end", { runner_errors: [captured(caught, undefined)], runner_error_count: 1 });
    throw caught;
  }
}
Object.defineProperty(globalThis, Symbol.for("launcher.test-proof.reach"), {
  configurable: true,
  value: (token) => emit("reach", { token: String(token).slice(0, 64) })
});
emit("session_start", { runner: { name: "deno", version: Deno.version.deno } });
const file = CONFIG.selected.file;
const [selectedName] = CONFIG.selected.test;
const register = Deno.test;
function definition(args) {
  const [first, second, third] = args;
  if (typeof first === "string") {
    return typeof second === "function" ? { name: first, fn: second } : { ...second, name: first, fn: third };
  }
  if (typeof first === "function") return { name: first.name, fn: first };
  if (typeof second === "function") return { ...first, name: first.name ?? second.name, fn: second };
  return { ...first };
}
// Every step of the selected test runs through its own Deno context; a step
// that fails (by throwing, or as Deno reports it when it resolves false) is
// recorded as the selected test's failure.
function stepDefinition(args) {
  const [first, second] = args;
  if (typeof first === "string") return { name: first, fn: second };
  if (typeof first === "function") return { name: first.name, fn: first };
  return { ...first };
}
function observeSteps(context, failures) {
  const step = context?.step;
  if (typeof step !== "function") return context;
  context.step = async function launcherObservedStep(...args) {
    const def = stepDefinition(args);
    const fn = def.fn;
    let threw = false;
    const observed = typeof fn !== "function" ? def : { ...def, fn: async function launcherObservedStepBody(child) {
      try {
        return await fn.call(this, observeSteps(child, failures));
      } catch (caught) {
        threw = true;
        failures.push({ step: def.name ?? null, threw: true, error: caught });
        throw caught;
      }
    } };
    const passed = await step.call(context, observed);
    // An ignored step also resolves false and does not fail its test.
    if (passed === false && def.ignore !== true && !threw) {
      failures.push({ step: def.name ?? null, threw: false, error: undefined });
    }
    return passed;
  };
  return context;
}
function observedTest(...args) {
  const def = definition(args);
  emit("collected", { file, test: [typeof def.name === "string" ? def.name : ""] });
  if (def.name !== selectedName) return register({ ...def, ignore: true });
  if (def.ignore === true) {
    emit("test_result", { file, test: [selectedName], outcome: "skipped", assertion_failure: false });
    return register(def);
  }
  const body = def.fn;
  return register({ ...def, fn: async function launcherObservedTestBody(t) {
    emit("test_start", { file, test: [selectedName] });
    const failures = [];
    let thrown = null;
    try {
      return await body.call(this, observeSteps(t, failures));
    } catch (caught) {
      thrown = { step: null, threw: true, error: caught };
      throw caught;
    } finally {
      emit("window_end", { file, test: [selectedName] });
      const failure = thrown ?? failures.find((entry) => entry.threw) ?? failures[0] ?? null;
      const assertion = failure?.threw === true && failure.error?.name === "AssertionError";
      emit("test_result", { file, test: [selectedName], outcome: failure !== null ? "failed" : "passed",
        assertion_failure: failure !== null && assertion,
        ...(failure !== null ? { failure_diagnostic: diagnostic(failure) } : {}) });
    }
  } });
}
observedTest.ignore = (...args) => observedTest({ ...definition(args), ignore: true });
observedTest.only = (...args) => observedTest({ ...definition(args), only: true });
Deno.test = observedTest;
`;
}

async function instrument(attempt) {
  const module = await instrumentJavaScriptAttempt(attempt);
  const observer = path.join(attempt.privateRoot, "deno-observer.js");
  const entry = path.join(attempt.privateRoot, "deno-entry.js");
  const config = { nonce: attempt.nonce, channel: attempt.channelPath,
    selected: { file: attempt.testFile, test: attempt.test } };
  return {
    ...module,
    writes: [...module.writes,
      { path: observer, content: observerSource(config) },
      { path: entry, content: `import { loadSelectedModule } from "./deno-observer.js";\n` +
        `await loadSelectedModule(() => import(${JSON.stringify(pathToFileURL(attempt.testFileWork).href)}));\n` }]
  };
}

export default nativeProviderImplementation({
  family_id: "deno",
  selector_kind: "deno_test_name",
  runtime_runner: "deno",
  identity_format: JSON_TITLE_PATH,
  completion: "selected_result",
  assets: [SPEC_ASSET, JAVASCRIPT_INSTRUMENTATION_ASSET, DIAGNOSTIC_GRAPH_ASSET],
  layout: javascriptLayout,
  instrument,
  invocation: (attempt) => integration.invocation({ runtime: attempt.runtime,
    hostProjectDir: attempt.projectHost, projectDir: attempt.workProject, entry: path.join(attempt.privateRoot, "deno-entry.js"),
    writablePaths: [attempt.channelPath] }),
  report: (attempt) => denoTestReport({ workRoot: attempt.workRoot, instrumented: attempt.module })
});
