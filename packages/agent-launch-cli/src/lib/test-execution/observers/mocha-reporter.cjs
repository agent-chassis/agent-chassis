"use strict";

const { createChannel, failureDiagnostic, installReachSink, loadConfig, repositoryPath, sameTitles } =
  require("./native-channel.cjs");

const Mocha = require(require.resolve("mocha", { paths: [process.cwd()] }));

const config = loadConfig();
const channel = createChannel(config, "mocha");
installReachSink(channel);
const { constants } = Mocha.Runner;
const file = config.selected.file;

const isAssertion = (error) => error !== null && typeof error === "object" &&
  (error.name === "AssertionError" || error.code === "ERR_ASSERTION");

function isSelected(test) {
  return repositoryPath(config, test.file) === file && sameTitles(test.titlePath(), config.selected.test);
}

function prune(suite) {
  suite.tests = suite.tests.filter((test) => {
    if (repositoryPath(config, test.file) === file) {
      channel.emit("collected", { file, test: test.titlePath() });
    }
    return isSelected(test);
  });
  for (const child of suite.suites) prune(child);
}

let selectedStarted = false;

function observeBody(test) {
  const body = test.fn;
  if (typeof body !== "function") return;
  const titles = test.titlePath();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    channel.emit("window_end", { file, test: titles });
  };
  test.fn = function launcherObservedTestBody(...args) {
    selectedStarted = true;
    channel.emit("test_start", { file, test: titles });
    if (test.async && typeof args[0] === "function") {
      const done = args[0];
      args[0] = function launcherObservedDone(...doneArgs) {
        close();
        return done.apply(this, doneArgs);
      };
    }
    let result;
    try {
      result = body.apply(this, args);
    } catch (error) {
      close();
      throw error;
    }
    if (result !== null && typeof result?.then === "function") {
      return result.then((value) => { close(); return value; },
        (error) => { close(); throw error; });
    }
    if (!test.async) close();
    return result;
  };
}

class LauncherTestProofReporter extends Mocha.reporters.Spec {
  constructor(runner, options) {

    let selected = null;
    const record = (test, outcome, error = null, hook = null) => {
      if (!isSelected(test) || selected?.outcome === "failed") return;
      selected = { titles: test.titlePath(), outcome, assertion: outcome === "failed" && isAssertion(error),
        diagnostic: outcome === "failed" ? failureDiagnostic(error,
          hook === null ? {} : { origin: { kind: "hook", name: hook } }) : null };
    };
    runner.on(constants.EVENT_TEST_FAIL, (test, error) => {
      if (test.type === "test") record(test, "failed", error);

      else if (selectedStarted && test.ctx?.currentTest) {
        const title = test.originalTitle ?? test.title;
        record(test.ctx.currentTest, "failed", error, typeof title === "string" ? title : null);
      }
    });
    super(runner, options);
    channel.emit("session_start", { runner: { name: "mocha", version: Mocha.prototype.version ?? null } });
    runner.once(constants.EVENT_RUN_BEGIN, () => prune(runner.suite));
    runner.on(constants.EVENT_TEST_BEGIN, (test) => {
      if (isSelected(test)) observeBody(test);
    });
    runner.on(constants.EVENT_TEST_PASS, (test) => record(test, "passed"));
    runner.on(constants.EVENT_TEST_PENDING, (test) => record(test, "skipped"));
    runner.once(constants.EVENT_RUN_END, () => {
      if (selected !== null) {
        const { titles, outcome, assertion, diagnostic } = selected;
        channel.emit("test_result", { file, test: titles, outcome, assertion_failure: assertion,
          ...(outcome === "failed" ? { failure_diagnostic: diagnostic } : {}) });
      }
      channel.emit("session_end");
    });
  }
}

module.exports = LauncherTestProofReporter;
