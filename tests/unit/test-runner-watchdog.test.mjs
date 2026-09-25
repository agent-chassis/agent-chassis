import assert from "node:assert/strict";
import test from "node:test";

import { parseTestRunnerOptions, TestRunnerOptionError } from
  "../helpers/test-runner-options.mjs";
import {
  createObserverFrameReader, createTestRunnerWatchdog,
  TEST_RUNNER_WATCHDOG_CODES, TestRunnerWatchdogError
} from "../helpers/test-runner-watchdog.mjs";

const root = "/example";
const selectedFiles = ["tests/unit/one.test.mjs"];
const parse = (tokens) => parseTestRunnerOptions(tokens, { repoRoot: root, selectedFiles });

test("runner binds native option values before selecting files and refuses ambiguous inputs", () => {
  const selected = parse([
    "--test-name-pattern", "other.test.mjs", "--import", "./setup.test.mjs",
    "--test-file-timeout", "1200", "--test-runner-phase-timeout=400",
    "--", "/tmp/outside.test.mjs"
  ]);
  assert.deepEqual(selected.files, ["/tmp/outside.test.mjs"]);
  assert.deepEqual(selected.native, ["--test-name-pattern", "other.test.mjs",
    "--import", "./setup.test.mjs"]);
  assert.equal(selected.fileTimeoutMs, 1200);
  assert.equal(selected.phaseTimeoutMs, 400);
  for (const tokens of [
    ["--test-file-timeout=0"], ["--test-file-timeout=Infinity"],
    ["--test-file-timeout=2147483648"], ["--test-file-timeout=1", "--test-file-timeout=2"],
    ["--test-reporter"], ["--unknown", "one.test.mjs"],
    ["*.test.mjs"], ["--", "*.test.mjs"]
  ]) {
    assert.throws(() => parse(tokens), (error) => error instanceof TestRunnerOptionError &&
      error.code === "test_runner.invalid_option.v1", tokens.join(" "));
  }
  for (const tokens of [["--watch"], ["--test-isolation=none"],
    ["--experimental-test-isolation=none"]]) {
    assert.throws(() => parse(tokens), { code: "test_runner.unsupported_execution_shape.v1" });
  }
  assert.deepEqual(parse(["./tests/unit/one.test.mjs", "tests/unit/one.test.mjs"]).files,
    ["/example/tests/unit/one.test.mjs"]);
});

test("first watchdog failure survives either deadline/exit ordering", () => {
  for (const deadlineFirst of [true, false]) {
    let now = 0;
    const failures = [];
    const watchdog = createTestRunnerWatchdog({
      files: ["/tmp/race.test.mjs"], fileTimeoutMs: 10, phaseTimeoutMs: 1000,
      clock: () => now, onProgress: () => {}, onFailure: (error) => failures.push(error)
    });
    try {
      watchdog.accept({ v: 2, type: "HELLO" });
      watchdog.accept({ v: 2, type: "FILE_START", file: "/tmp/race.test.mjs", id: 1 });
      now = 11;
      const deadline = new TestRunnerWatchdogError(TEST_RUNNER_WATCHDOG_CODES.FILE_TIMEOUT,
        "file deadline expired", { file: "/tmp/race.test.mjs", elapsedMs: now, budgetMs: 10 });
      const exit = () => watchdog.finalize({ code: 0 }, { pipeEnded: false });
      if (deadlineFirst) {
        assert.equal(watchdog.fail(deadline), deadline);
        assert.equal(exit(), deadline);
      } else {
        const exitFailure = exit();
        assert.equal(exitFailure.code, TEST_RUNNER_WATCHDOG_CODES.LOST);
        assert.equal(watchdog.fail(deadline), exitFailure);
      }
      assert.equal(failures.length, 1);
      assert.equal(watchdog.failure, failures[0]);
    } finally {
      watchdog.dispose();
    }
  }
});

test("observer frames remain bounded and complete file wrappers by exact path and id", () => {
  const progress = [];
  const failures = [];
  const watchdog = createTestRunnerWatchdog({
    files: ["/tmp/a.test.mjs", "/tmp/b.test.mjs"],
    fileTimeoutMs: 1000, phaseTimeoutMs: 1000,
    onProgress: (event) => progress.push(event),
    onFailure: (error) => failures.push(error)
  });
  const reader = createObserverFrameReader({
    onFrame: (frame) => watchdog.accept(frame),
    onFailure: (error) => watchdog.fail(error)
  });
  const frames = [
    { v: 2, type: "HELLO" },
    { v: 2, type: "FILE_START", file: "/tmp/a.test.mjs", id: 4 },
    { v: 2, type: "FILE_START", file: "/tmp/b.test.mjs", id: 5 },
    { v: 2, type: "FILE_END", file: "/tmp/b.test.mjs", id: 5, outcome: "pass" },
    { v: 2, type: "FILE_END", file: "/tmp/a.test.mjs", id: 4, outcome: "fail" },
    { v: 2, type: "STREAM_END" }
  ].map((frame) => `${JSON.stringify(frame)}\n`).join("");
  const bytes = Buffer.from(frames);
  for (let offset = 0; offset < bytes.length; offset += 3) reader.push(bytes.subarray(offset, offset + 3));
  reader.end();
  assert.equal(watchdog.finalize({ code: 1 }, { pipeEnded: true }), null);
  assert.deepEqual(progress.map((event) => event.type), ["START", "START", "FINISH", "FINISH"]);
  assert.deepEqual(progress.filter((event) => event.type === "FINISH")
    .map((event) => event.outcome), ["pass", "fail"]);
  assert.deepEqual(failures, []);
  watchdog.dispose();
});

test("a peer completion cannot retire another file's absolute deadline", async () => {
  const failures = [];
  const watchdog = createTestRunnerWatchdog({
    files: ["/tmp/hung.test.mjs", "/tmp/peer.test.mjs"],
    fileTimeoutMs: 35, phaseTimeoutMs: 1000,
    onProgress: () => {}, onFailure: (error) => failures.push(error)
  });
  try {
    watchdog.accept({ v: 2, type: "HELLO" });
    watchdog.accept({ v: 2, type: "FILE_START", file: "/tmp/hung.test.mjs", id: 1 });
    watchdog.accept({ v: 2, type: "FILE_START", file: "/tmp/peer.test.mjs", id: 2 });
    watchdog.accept({ v: 2, type: "FILE_END", file: "/tmp/peer.test.mjs", id: 2, outcome: "pass" });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(failures.length, 1);
    assert.equal(failures[0].code, TEST_RUNNER_WATCHDOG_CODES.FILE_TIMEOUT);
    assert.equal(failures[0].detail.file, "/tmp/hung.test.mjs");
  } finally {
    watchdog.dispose();
  }
});

test("malformed or early-ended observer streams cannot report clean success", () => {
  const failures = [];
  const watchdog = createTestRunnerWatchdog({
    files: ["/tmp/a.test.mjs"], fileTimeoutMs: 1000, phaseTimeoutMs: 1000,
    onProgress: () => {}, onFailure: (error) => failures.push(error)
  });
  const reader = createObserverFrameReader({
    onFrame: (frame) => watchdog.accept(frame), onFailure: (error) => watchdog.fail(error)
  });
  reader.push(Buffer.from('{"v":2,"type":"HELLO"}\n{"v":2'));
  reader.end();
  assert.equal(failures[0].code, TEST_RUNNER_WATCHDOG_CODES.PROTOCOL);
  assert.equal(watchdog.finalize({ code: 0 }, { pipeEnded: true }), failures[0]);
  watchdog.dispose();
});

test("observer rejects oversized, unknown and duplicate control records", () => {
  for (const frames of [
    ['{"v":2,"type":"HELLO","extra":true}\n'],
    ['{"v":1,"type":"HELLO"}\n'],
    [`${"x".repeat(16 * 1024)}\n`],
    ['{"v":2,"type":"HELLO"}\n', '{"v":2,"type":"HELLO"}\n'],
    ['{"v":2,"type":"HELLO"}\n',
      '{"v":2,"type":"FILE_END","file":"/tmp/a.test.mjs","id":1,"outcome":"pass"}\n']
  ]) {
    const failures = [];
    const watchdog = createTestRunnerWatchdog({
      files: ["/tmp/a.test.mjs"], fileTimeoutMs: 1000, phaseTimeoutMs: 1000,
      onProgress: () => {}, onFailure: (error) => failures.push(error)
    });
    try {
      const reader = createObserverFrameReader({
        onFrame: (frame) => watchdog.accept(frame),
        onFailure: (error) => watchdog.fail(error)
      });
      for (const frame of frames) reader.push(Buffer.from(frame));
      reader.end();
      assert.equal(failures.length, 1, frames.join(""));
      assert.equal(failures[0].code, TEST_RUNNER_WATCHDOG_CODES.PROTOCOL);
    } finally {
      watchdog.dispose();
    }
  }
});

test("a clean stream cannot omit a selected file", () => {
  const failures = [];
  const watchdog = createTestRunnerWatchdog({
    files: ["/tmp/a.test.mjs", "/tmp/b.test.mjs"],
    fileTimeoutMs: 1000, phaseTimeoutMs: 1000,
    onProgress: () => {}, onFailure: (error) => failures.push(error)
  });
  try {
    watchdog.accept({ v: 2, type: "HELLO" });
    watchdog.accept({ v: 2, type: "FILE_START", file: "/tmp/a.test.mjs", id: 1 });
    watchdog.accept({ v: 2, type: "FILE_END", file: "/tmp/a.test.mjs", id: 1, outcome: "pass" });
    watchdog.accept({ v: 2, type: "STREAM_END" });
    watchdog.finalize({ code: 0 }, { pipeEnded: true });
    assert.equal(failures[0].code, TEST_RUNNER_WATCHDOG_CODES.LOST);
    assert.equal(failures[0].detail.completedCount, 1);
    assert.equal(failures[0].detail.selectedCount, 2);
  } finally {
    watchdog.dispose();
  }
});

test("reporter pair binding and explicit file separator preserve native arguments", () => {
  const options = parse([
    "--test-reporter=spec", "--test-reporter-destination=stdout",
    "--test-reporter", "junit", "--test-reporter-destination", "/tmp/report.xml",
    "--", "/tmp/selected.test.mjs"
  ]);
  assert.equal(options.reporterCount, 2);
  assert.equal(options.destinationCount, 2);
  assert.deepEqual(options.files, ["/tmp/selected.test.mjs"]);
  assert.deepEqual(options.native, [
    "--test-reporter=spec", "--test-reporter-destination=stdout",
    "--test-reporter", "junit", "--test-reporter-destination", "/tmp/report.xml"
  ]);
  assert.throws(() => parse(["--test-reporter=spec", "--test-reporter=junit"]),
    { code: "test_runner.invalid_option.v1" });
});

test("startup and post-file intervals keep separate bounded phase clocks", async () => {
  const startupFailures = [];
  const startup = createTestRunnerWatchdog({
    files: ["/tmp/a.test.mjs"], fileTimeoutMs: 1000, phaseTimeoutMs: 200,
    onProgress: () => {}, onFailure: (error) => startupFailures.push(error)
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 120));
    startup.accept({ v: 2, type: "HELLO" });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(startupFailures[0].code, TEST_RUNNER_WATCHDOG_CODES.STARTUP_TIMEOUT);
  } finally {
    startup.dispose();
  }

  const phaseFailures = [];
  const phase = createTestRunnerWatchdog({
    files: ["/tmp/b.test.mjs"], fileTimeoutMs: 1000, phaseTimeoutMs: 40,
    onProgress: () => {}, onFailure: (error) => phaseFailures.push(error)
  });
  try {
    phase.accept({ v: 2, type: "HELLO" });
    phase.accept({ v: 2, type: "FILE_START", file: "/tmp/b.test.mjs", id: 1 });
    phase.accept({ v: 2, type: "FILE_END", file: "/tmp/b.test.mjs", id: 1, outcome: "pass" });
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(phaseFailures[0].code, TEST_RUNNER_WATCHDOG_CODES.PHASE_TIMEOUT);
  } finally {
    phase.dispose();
  }
});

test("a recording failure is reported beside the file lifecycle, never as observer loss", () => {
  const failures = [];
  const recording = [];
  const watchdog = createTestRunnerWatchdog({
    files: ["/tmp/a.test.mjs"], fileTimeoutMs: 1000, phaseTimeoutMs: 1000,
    onProgress: () => {}, onFailure: (error) => failures.push(error),
    onRecordingFailure: (status) => recording.push(status)
  });
  try {
    const reader = createObserverFrameReader({
      onFrame: (frame) => watchdog.accept(frame), onFailure: (error) => watchdog.fail(error)
    });
    reader.push(Buffer.from([
      '{"v":2,"type":"HELLO"}',
      '{"v":2,"type":"FILE_START","file":"/tmp/a.test.mjs","id":1}',
      '{"v":2,"type":"RECORDING_FAILURE","code":"test_runner.artifact_write_failed.v1","message":"disk full"}',
      '{"v":2,"type":"FILE_END","file":"/tmp/a.test.mjs","id":1,"outcome":"pass"}',
      '{"v":2,"type":"STREAM_END"}', ""
    ].join("\n")));
    reader.end();
    assert.deepEqual(recording, [{ code: "test_runner.artifact_write_failed.v1", message: "disk full" }]);
    assert.equal(watchdog.finalize({ code: 0 }, { pipeEnded: true }), null);
    assert.deepEqual(failures, []);
  } finally {
    watchdog.dispose();
  }
});
