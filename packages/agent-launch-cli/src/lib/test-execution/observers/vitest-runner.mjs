

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
    if (isSelected(test)) {
      const state = test.result?.state;
      const error = test.result?.errors?.[0] ?? null;
      const assertion = error?.name === "AssertionError";
      const outcome = state === "pass" ? "passed" : state === "fail" ? "failed" : "skipped";
      channel.emit("test_result", { file: config.selected.file, test: titlePath(test), outcome,
        assertion_failure: outcome === "failed" && assertion,
        error: outcome === "failed" ? errorFacts(error, assertion) : null });
    }
    return super.onAfterRunTask(test);
  }
}
