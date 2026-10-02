

import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

import channelModule from "./native-channel.cjs";

const { createChannel, failureDiagnostic, installReachSink, loadConfig, repositoryPath } = channelModule;
const config = loadConfig();
const channel = createChannel(config, "ava.worker");
installReachSink(channel);
const file = config.selected.file;
const [selectedTitle] = config.selected.test;
const WRAPPER_SCHEME = "launcher-test-proof-ava:";
const WRAP_SYMBOL = Symbol.for("launcher.test-proof.ava-chain");

channel.emit("session_start", { runner: { name: "ava", version: null } });

function nativeFacts(serialized) {
  const facts = {};
  const source = serialized?.source;
  if (typeof source?.file === "string" && Number.isSafeInteger(source.line) && source.line > 0) {
    let file = null;
    try {
      file = repositoryPath(config, source.file.startsWith("file:") ? fileURLToPath(source.file) : source.file);
    } catch { file = null; }
    if (file !== null) facts.location = { file, line: source.line };
  }
  if (typeof serialized?.assertion === "string" && serialized.assertion.length > 0) {
    facts.operator = serialized.assertion;
  }
  const details = (Array.isArray(serialized?.formattedDetails) ? serialized.formattedDetails : [])
    .filter((entry) => typeof entry?.formatted === "string")
    .map((entry) => ({ label: typeof entry.label === "string" && entry.label.length > 0 ? entry.label
      : "details", text: entry.formatted }));
  if (typeof serialized?.formattedError === "string") {
    details.push({ label: "formatted_error", text: serialized.formattedError });
  }
  return details.length === 0 ? facts : { ...facts, details };
}

const send = process.send;
if (typeof send !== "function") {
  channel.emit("runtime_error", { code: "test_proof_native_runner_unsupported",
    message: "the AVA proof observer requires a forked AVA worker" });
} else {
  process.send = function launcherObservedSend(message, ...rest) {
    const event = message?.ava;
    const title = event?.title;
    if (event?.type === "declared-test" && typeof title === "string") {
      channel.emit("collected", { file, test: [title] });
    } else if (title === selectedTitle && event.type === "selected-test" &&
        (event.skip === true || event.todo === true)) {
      channel.emit("test_result", { file, test: [title], outcome: "skipped",
        assertion_failure: false });
    } else if (title === selectedTitle && event.type === "test-passed") {
      channel.emit("test_result", { file, test: [title], outcome: "passed",
        assertion_failure: false });
    } else if (title === selectedTitle && event.type === "test-failed") {
      const assertion = event.err?.name === "AssertionError";
      const original = event.err !== null && typeof event.err === "object" &&
        Object.hasOwn(event.err, "originalError") ? event.err.originalError : undefined;
      channel.emit("test_result", { file, test: [title], outcome: "failed",
        assertion_failure: assertion, failure_diagnostic: failureDiagnostic(original, nativeFacts(event.err)) });
    } else if (event?.type === "worker-finished") {
      channel.emit("session_end");
    }
    return send.call(this, message, ...rest);
  };
}

function projectModule(url) {
  if (typeof url !== "string" || !url.startsWith("file:")) return false;
  const relative = repositoryPath(config, fileURLToPath(url));
  return relative !== null && !relative.split("/").includes("node_modules");
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "ava" && projectModule(context.parentURL)) {
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
      `import test from ${real};\nexport * from ${real};\n` +
      `export default globalThis[Symbol.for("launcher.test-proof.ava-chain")](test);\n` };
  }
});

function observedBody(implementation) {
  return async function launcherObservedTestBody(t, ...args) {
    channel.emit("test_start", { file, test: [selectedTitle] });
    try {
      return await implementation(t, ...args);
    } finally {
      channel.emit("window_end", { file, test: [selectedTitle] });
    }
  };
}

const TEST_CHAINS = new Set(["serial", "failing"]);

function wrapChain(chain) {
  return new Proxy(chain, {
    apply(target, thisArg, args) {
      const [title, implementation] = args;
      if (typeof title !== "string") return Reflect.apply(target, thisArg, args);
      if (title !== selectedTitle) {
        return typeof target.skip === "function"
          ? Reflect.apply(target.skip, thisArg, args) : Reflect.apply(target, thisArg, args);
      }
      if (typeof implementation !== "function") {
        channel.emit("runtime_error", { code: "test_proof_native_selection_unsupported",
          message: "the selected AVA test must have a function implementation" });
        return Reflect.apply(target, thisArg, args);
      }
      return Reflect.apply(target, thisArg, [title, observedBody(implementation), ...args.slice(2)]);
    },
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return TEST_CHAINS.has(property) && typeof value === "function" ? wrapChain(value) : value;
    }
  });
}

Object.defineProperty(globalThis, WRAP_SYMBOL, { value: wrapChain, configurable: true });
