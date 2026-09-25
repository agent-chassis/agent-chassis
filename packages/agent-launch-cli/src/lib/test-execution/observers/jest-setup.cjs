"use strict";

const { createChannel, errorFacts, installReachSink, loadConfig, repositoryPath, sameTitles } =
  require("./native-channel.cjs");

const config = loadConfig();
const channel = createChannel(config, "jest.test");
installReachSink(channel);
const handlers = globalThis[Symbol.for("EVENT_HANDLERS")];
const file = config.selected.file;

function titlePath(block, leaf = []) {
  const titles = [...leaf];
  for (let node = block; node !== undefined && node !== null && node.parent !== undefined &&
    node.parent !== null; node = node.parent) titles.unshift(node.name);
  return titles;
}

function firstError(errors) {
  const [entry] = errors ?? [];
  return Array.isArray(entry) ? entry[0] : entry;
}

function isAssertion(error) {
  return error !== null && typeof error === "object" && (error.matcherResult !== undefined ||
    error.name === "AssertionError" || error.code === "ERR_ASSERTION" ||
    error.constructor?.name === "JestAssertionError");
}

if (!Array.isArray(handlers)) {
  channel.emit("runtime_error", { code: "test_proof_native_runner_unsupported",
    message: "the Jest circus event handlers are not available" });
} else if (repositoryPath(config, expect.getState().testPath) !== file) {
  channel.emit("runtime_error", { code: "test_proof_native_selection_unsupported",
    message: "Jest ran a test file other than the selected one" });
} else {
  let selected = null;
  const encloses = (block, test) => {
    for (let node = test.parent; node !== undefined && node !== null; node = node.parent) {
      if (node === block) return true;
    }
    return false;
  };
  handlers.push((event, state) => {
    if (event.name === "hook_failure" && event.hook?.type === "afterAll") {
      if (selected?.started && selected.error === null && encloses(event.describeBlock, selected.test)) {
        selected.error = event.error;
      }
      return;
    }
    if (event.name === "run_finish") {
      if (selected?.titles !== undefined) {
        const { titles, error, outcome } = selected;
        const failed = outcome === "failed" || error !== null;
        channel.emit("test_result", { file, test: titles,
          outcome: failed ? "failed" : outcome,
          assertion_failure: failed && isAssertion(error),
          error: failed ? errorFacts(error, isAssertion(error)) : null });
      }
      return;
    }
    if (event.name === "add_test") {
      channel.emit("collected", { file, test: titlePath(state.currentDescribeBlock, [event.testName]) });
      return;
    }
    const test = event.test;
    if (test === undefined) return;
    const titles = titlePath(test.parent, [test.name]);
    const isSelected = sameTitles(titles, config.selected.test);
    if (event.name === "test_start" && !isSelected) {
      test.mode = "skip";
      return;
    }
    if (!isSelected) return;
    selected ??= { test, titles: undefined, started: false, outcome: null, error: null };
    if (event.name === "test_fn_start") {
      selected.started = true;
      channel.emit("test_start", { file, test: titles });
    } else if (event.name === "test_fn_success" || event.name === "test_fn_failure") {
      channel.emit("window_end", { file, test: titles });
    } else if (event.name === "test_skip" || event.name === "test_todo") {
      channel.emit("test_result", { file, test: titles, outcome: "skipped", assertion_failure: false,
        error: null });
    } else if (event.name === "test_done") {

      selected.titles = titles;
      selected.outcome = test.errors.length > 0 ? "failed" : "passed";
      if (test.errors.length > 0) selected.error = firstError(test.errors);
    }
  });
}
