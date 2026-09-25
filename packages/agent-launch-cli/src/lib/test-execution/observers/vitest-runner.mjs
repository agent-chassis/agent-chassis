

import { createRequire } from "node:module";

import { TestRunner } from "vitest";

const channelModule = createRequire(import.meta.url)("./native-channel.cjs");
const { createChannel, errorFacts, installReachSink, loadConfig, repositoryPath, sameTitles } =
  channelModule;
const config = loadConfig();
const channel = createChannel(config, "vitest.worker");
installReachSink(channel);

function titlePath(task) {
  const titles = [];
  for (let node = task; node !== undefined && node !== task.file; node = node.suite) {
    titles.unshift(node.name);
  }
  return titles;
}

function visit(task, fn) {
  fn(task);
  for (const child of task.tasks ?? []) visit(child, fn);
}

const selectedFile = (task) => repositoryPath(config, task.file.filepath) === config.selected.file;
const isSelected = (task) => selectedFile(task) && sameTitles(titlePath(task), config.selected.test);

let selectedResult = null;

export default class LauncherTestProofRunner extends TestRunner {
  onCollected(files) {
    for (const file of files) {
      const inSelectedFile = repositoryPath(config, file.filepath) === config.selected.file;
      visit(file, (task) => {
        if (task.type !== "test") return;
        if (inSelectedFile) channel.emit("collected", { file: config.selected.file, test: titlePath(task) });
        if (!inSelectedFile || !isSelected(task)) task.mode = "skip";
      });
    }
    return super.onCollected?.(files);
  }

  async onBeforeRunTask(test) {
    await super.onBeforeRunTask(test);
    if (isSelected(test) && test.mode !== "run" && test.mode !== "queued") {
      selectedResult = { test, reported: true };
      channel.emit("test_result", { file: config.selected.file, test: titlePath(test),
        outcome: "skipped", assertion_failure: false, error: null });
    }
  }

  onBeforeTryTask(test, options) {
    if (isSelected(test)) channel.emit("test_start", { file: config.selected.file, test: titlePath(test) });
    return super.onBeforeTryTask(test, options);
  }

  onAfterTryTask(test, options) {
    if (isSelected(test)) channel.emit("window_end", { file: config.selected.file, test: titlePath(test) });
    return super.onAfterTryTask(test, options);
  }

  onAfterRunTask(test) {
    if (isSelected(test) && selectedResult?.reported !== true) {
      const state = test.result?.state;
      selectedResult = { test, reported: false, error: test.result?.errors?.[0] ?? null,
        outcome: state === "pass" ? "passed" : state === "fail" ? "failed" : "skipped" };
    }
    return super.onAfterRunTask(test);
  }

  onAfterRunSuite(suite) {
    const recorded = selectedResult;
    if (recorded !== null && !recorded.reported) {
      let encloses = false;
      for (let node = recorded.test.suite; node !== undefined; node = node.suite) {
        if (node === suite) encloses = true;
      }
      const suiteError = suite.result?.errors?.[0] ?? null;
      if (encloses && suiteError !== null && recorded.outcome === "passed") {
        recorded.outcome = "failed";
        recorded.error = suiteError;
      }
      if (suite === recorded.test.file) {
        recorded.reported = true;
        const { outcome, error } = recorded;
        const assertion = error?.name === "AssertionError";
        channel.emit("test_result", { file: config.selected.file, test: titlePath(recorded.test), outcome,
          assertion_failure: outcome === "failed" && assertion,
          error: outcome === "failed" ? errorFacts(error, assertion) : null });
      }
    }
    return super.onAfterRunSuite?.(suite);
  }
}
