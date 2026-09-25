

import { TEST_TIMING_CODES, timingFailure } from "./test-timing-diagnostics.mjs";

export const NATIVE_TIMING_EVENTS = Object.freeze(["test:dequeue", "test:complete"]);

function sourceOf(data) {
  return { file: typeof data.file === "string" ? data.file : null,
    line: Number.isSafeInteger(data.line) ? data.line : null,
    column: Number.isSafeInteger(data.column) ? data.column : null };
}

export function createNativeTimingRecorder({ journal, suiteProducerId }) {

  const wrappers = new Map();

  function identityFor(data, wrapper) {
    if (wrapper !== null) {
      return { namespace: "file", suite_producer: suiteProducerId, file: wrapper.file,
        test_id: wrapper.id };
    }
    const entryFile = typeof data.entryFile === "string" ? data.entryFile : null;
    const wrapperId = entryFile === null ? undefined : wrappers.get(entryFile);
    return { namespace: "test", entry_file: entryFile,
      source_producer: wrapperId === undefined ? null
        : `${suiteProducerId}/file/${wrapperId}`,
      test_id: Number.isSafeInteger(data.testId) ? data.testId : null };
  }

  function complete(identity) {
    return identity.namespace === "file" ||
      identity.entry_file !== null && identity.source_producer !== null && identity.test_id !== null;
  }

  function write(fields) {
    const failure = journal.append(fields);
    if (failure !== null) throw failure;
  }

  return Object.freeze({
    begin() {
      write({ event: "stream_start", producer_kind: "native-observer", pid: process.pid,
        node_version: process.version });
    },

    observe(event, wrapper) {
      if (!NATIVE_TIMING_EVENTS.includes(event.type)) return;
      const data = event.data ?? {};
      if (wrapper !== null && event.type === "test:dequeue") wrappers.set(wrapper.file, wrapper.id);
      const identity = identityFor(data, wrapper);
      const common = { identity, identity_complete: complete(identity),
        name: typeof data.name === "string" ? data.name : null, source: sourceOf(data),
        nesting: Number.isSafeInteger(data.nesting) ? data.nesting : null,
        parent_id: Number.isSafeInteger(data.parentId) ? data.parentId : null };
      if (event.type === "test:dequeue") {
        write({ event: "start", kind: wrapper !== null ? "file" : null,
          native_type: typeof data.type === "string" ? data.type : null, ...common });
        return;
      }
      const details = data.details ?? {};
      const duration = details.duration_ms;
      write({ event: "complete",
        kind: wrapper !== null ? "file" : typeof details.type === "string" ? details.type : null,
        ...common,
        outcome: details.passed === true ? "pass" : "fail",
        skip: data.skip ?? null,
        todo: data.todo ?? null,
        failure_type: typeof details.error?.failureType === "string" ? details.error.failureType : null,
        duration_ms: Number.isFinite(duration) && duration >= 0 ? duration : null });
    },
    finish() {
      write({ event: "stream_end" });
    }
  });
}

export function asTimingFailure(error) {
  if (typeof error?.code === "string" && error.code.startsWith("test_runner.")) return error;
  return timingFailure(TEST_TIMING_CODES.TIMING_RECORD_INVALID,
    `native timing record failed: ${error?.message ?? error}`, {});
}
