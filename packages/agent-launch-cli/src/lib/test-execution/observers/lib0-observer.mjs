

import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

import channelModule from "./native-channel.cjs";

const { createChannel, errorFacts, installReachSink, loadConfig, repositoryPath } = channelModule;
const config = loadConfig();
const channel = createChannel(config, "lib0");
installReachSink(channel);
const file = config.selected.file;
const [selectedModule, selectedFunction] = config.selected.test;
const WRAPPER_SCHEME = "launcher-test-proof-lib0:";
const RUN_TESTS_SYMBOL = Symbol.for("launcher.test-proof.lib0-run-tests");

channel.emit("session_start", { runner: { name: "lib0/testing", version: null } });

function projectModule(url) {
  if (typeof url !== "string" || !url.startsWith("file:")) return false;
  const relative = repositoryPath(config, fileURLToPath(url));
  return relative !== null && !relative.split("/").includes("node_modules");
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "lib0/testing" && projectModule(context.parentURL)) {
      const real = nextResolve(specifier, context);
      return { url: `${WRAPPER_SCHEME}${encodeURIComponent(real.url)}`, format: "module",
        shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.startsWith(WRAPPER_SCHEME)) return nextLoad(url, context);
    const real = JSON.stringify(decodeURIComponent(url.slice(WRAPPER_SCHEME.length)));
    return { format: "module", shortCircuit: true, source:
      `import * as real from ${real};\nexport * from ${real};\n` +
      `export const runTests = globalThis[Symbol.for("launcher.test-proof.lib0-run-tests")](real.runTests);\n` };
  }
});

const isTestFunction = (name) => name.startsWith("test") || name.startsWith("benchmark");

function observedBody(fn) {
  const test = [selectedModule, selectedFunction];
  return async function launcherObservedTestBody(tc) {
    channel.emit("test_start", { file, test });
    let error = null;
    try {
      return await fn(tc);
    } catch (caught) {
      error = caught;
      throw caught;
    } finally {
      channel.emit("window_end", { file, test });
      const skipped = error?.constructor?.name === "SkipError";
      const assertion = error?.constructor?.name === "TestError";
      channel.emit("test_result", { file, test,
        outcome: error === null ? "passed" : skipped ? "skipped" : "failed",
        assertion_failure: error !== null && !skipped && assertion,
        error: error === null || skipped ? null : errorFacts(error, assertion) });
    }
  };
}

function observedRunTests(runTests) {
  let used = false;
  return async function launcherObservedRunTests(tests) {
    if (used) {
      channel.emit("runtime_error", { code: "test_proof_native_selection_unsupported",
        message: "the lib0 harness called runTests more than once" });
      return false;
    }
    used = true;
    for (const [moduleName, module] of Object.entries(tests ?? {})) {
      for (const [name, fn] of Object.entries(module ?? {})) {
        if (typeof fn === "function" && isTestFunction(name)) {
          channel.emit("collected", { file, test: [moduleName, name] });
        }
      }
    }
    const selected = tests?.[selectedModule]?.[selectedFunction];
    const filtered = typeof selected === "function"
      ? { [selectedModule]: { [selectedFunction]: observedBody(selected) } } : {};
    try {
      return await runTests(filtered);
    } finally {
      channel.emit("session_end");
    }
  };
}

Object.defineProperty(globalThis, RUN_TESTS_SYMBOL, { value: observedRunTests, configurable: true });
