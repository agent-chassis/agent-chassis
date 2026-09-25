

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import integration from "../runner-integrations/deno.mjs";
import { JAVASCRIPT_INSTRUMENTATION_ASSET, JSON_TITLE_PATH, instrumentJavaScriptAttempt,
  javascriptLayout } from "./javascript-support.mjs";
import { nativeProviderImplementation } from "./native-lifecycle.mjs";

const SPEC_ASSET = fileURLToPath(import.meta.url);

function observerSource(config) {
  return `// Launcher Deno test-proof observer (generated per attempt).
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
function facts(error, assertion) {
  const out = { assertion };
  for (const field of ["name", "message", "stack"]) {
    try {
      if (typeof error?.[field] === "string") out[field] = error[field].slice(0, 65536);
    } catch {}
  }
  return out;
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
        failures.push(caught);
        throw caught;
      }
    } };
    const passed = await step.call(context, observed);
    // An ignored step also resolves false and does not fail its test.
    if (passed === false && def.ignore !== true && !threw) failures.push(null);
    return passed;
  };
  return context;
}
function observedTest(...args) {
  const def = definition(args);
  emit("collected", { file, test: [typeof def.name === "string" ? def.name : ""] });
  if (def.name !== selectedName) return register({ ...def, ignore: true });
  if (def.ignore === true) {
    emit("test_result", { file, test: [selectedName], outcome: "skipped", assertion_failure: false,
      error: null });
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
      thrown = caught;
      throw caught;
    } finally {
      emit("window_end", { file, test: [selectedName] });
      const failed = thrown !== null || failures.length > 0;
      const error = thrown ?? failures.find((entry) => entry !== null) ?? null;
      const assertion = error?.name === "AssertionError";
      emit("test_result", { file, test: [selectedName], outcome: failed ? "failed" : "passed",
        assertion_failure: failed && assertion,
        error: failed ? facts(error, assertion) : null });
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
      { path: entry, content: `import "./deno-observer.js";\nimport ${JSON.stringify(
        pathToFileURL(attempt.testFileWork).href)};\n` }]
  };
}

export default nativeProviderImplementation({
  family_id: "deno",
  selector_kind: "deno_test_name",
  runtime_runner: "deno",
  identity_format: JSON_TITLE_PATH,
  completion: "selected_result",
  assets: [SPEC_ASSET, JAVASCRIPT_INSTRUMENTATION_ASSET],
  layout: javascriptLayout,
  instrument,
  invocation: (attempt) => integration.invocation({ runtime: attempt.runtime,
    hostProjectDir: attempt.projectHost, projectDir: attempt.workProject, entry: path.join(attempt.privateRoot, "deno-entry.js"),
    writablePaths: [attempt.channelPath] })
});
