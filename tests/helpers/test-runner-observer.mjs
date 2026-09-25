

import { randomBytes } from "node:crypto";
import { writeSync } from "node:fs";
import path from "node:path";

import { asTimingFailure, createNativeTimingRecorder } from "./test-native-timing.mjs";
import { openTimingJournal } from "./test-timing-journal.mjs";
import { TEST_RUN_EVENTS_FILE, readTestRunContext } from "./test-run-context.mjs";
import { TEST_TIMING_CODES } from "./test-timing-diagnostics.mjs";
import { OBSERVER_RECORDING_MESSAGE_MAX, encodeObserverFrame } from "./test-runner-observer-protocol.mjs";

export const TEST_RUNNER_OBSERVER_URL = import.meta.url;
const CONTROL_FD = 3;

function emit(frame) {
  const bytes = encodeObserverFrame(frame);
  for (let offset = 0; offset < bytes.length;) {
    const written = writeSync(CONTROL_FD, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new Error("test runner observer control pipe made no progress");
    offset += written;
  }
}

function wrapper(event) {
  const data = event?.data;
  if (data === null || typeof data !== "object" ||
      data.nesting !== 0 || Object.hasOwn(data, "entryFile") ||
      typeof data.name !== "string" || !path.isAbsolute(data.name) ||
      typeof data.file !== "string" || !path.isAbsolute(data.file) ||
      path.resolve(data.name) !== path.resolve(data.file)) return null;
  return { file: path.resolve(data.file), id: data.testId };
}

function openTiming() {
  const found = readTestRunContext();
  if (found === null || found.problem) {
    return { failure: { code: TEST_TIMING_CODES.TIMING_INCOMPLETE,
      message: `native timing is not recorded: ${found?.problem ?? "no run context"}` } };
  }
  const suiteProducerId = `observer-${process.pid}-${randomBytes(6).toString("hex")}`;
  const journal = openTimingJournal(path.join(found.context.runDir, TEST_RUN_EVENTS_FILE),
    { runId: found.context.runId, producerId: suiteProducerId });
  if (journal.failure !== null) return { failure: journal.failure };
  return { journal, recorder: createNativeTimingRecorder({ journal, suiteProducerId }) };
}

export default async function* observeTests(source) {
  emit({ type: "HELLO" });
  let timing = openTiming();
  function recordingFailed(error) {
    const failure = asTimingFailure(error);
    timing?.journal?.close();
    timing = null;
    emit({ type: "RECORDING_FAILURE", code: failure.code,
      message: String(failure.message).slice(0, OBSERVER_RECORDING_MESSAGE_MAX) });
  }
  function record(operation) {
    if (timing?.recorder === undefined) return;
    try {
      operation(timing.recorder);
    } catch (error) {
      recordingFailed(error);
    }
  }
  if (timing.failure) recordingFailed(timing.failure);
  record((recorder) => recorder.begin());
  for await (const event of source) {
    if (event.type !== "test:dequeue" && event.type !== "test:complete") continue;
    const identity = wrapper(event);

    record((recorder) => recorder.observe(event, identity));
    if (identity === null) continue;
    if (event.type === "test:dequeue") {
      emit({ type: "FILE_START", ...identity });
    } else {
      const details = event.data.details;
      emit({ type: "FILE_END", ...identity,
        outcome: details?.passed === true ? "pass" : "fail" });
    }
  }
  record((recorder) => recorder.finish());
  timing?.journal?.close();
  emit({ type: "STREAM_END" });
}
