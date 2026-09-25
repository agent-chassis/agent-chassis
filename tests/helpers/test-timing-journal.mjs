

import { closeSync, constants as fsConstants, openSync, readSync, writeSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { createBoundedLineReader } from "./bounded-line-reader.mjs";
import { TEST_TIMING_CODES, timingFailure } from "./test-timing-diagnostics.mjs";

export const TIMING_RECORD_SCHEMA = "test-timing-record.v1";
export const TIMING_MAX_RECORD_BYTES = 64 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const DECODER = new TextDecoder("utf-8", { fatal: true });
const RESERVED_FIELDS = new Set(["schema", "run_id", "producer_id", "seq", "wall_ms", "mono_ms"]);

export function encodeTimingRecord(record) {
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
  if (bytes.length > TIMING_MAX_RECORD_BYTES) {
    throw timingFailure(TEST_TIMING_CODES.TIMING_RECORD_INVALID,
      `timing record of ${bytes.length} bytes exceeds the ${TIMING_MAX_RECORD_BYTES}-byte bound`,
      { producer_id: record.producer_id, seq: record.seq, event: record.event });
  }
  return bytes;
}

export function openTimingJournal(filePath, { runId, producerId, clock = () => performance.now() }) {
  let fd = null;
  let failure = null;
  let sequence = 0;
  try {
    fd = openSync(filePath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL |
      fsConstants.O_APPEND | fsConstants.O_NOFOLLOW, 0o600);
  } catch (error) {
    failure = timingFailure(TEST_TIMING_CODES.ARTIFACT_WRITE_FAILED,
      `timing journal could not be created: ${error.message}`,
      { path: filePath, producer_id: producerId, errno: error.code ?? null });
  }

  function latch(error) {
    failure ??= error;
    return failure;
  }

  function append(fields) {
    if (failure !== null) return failure;
    for (const name of Object.keys(fields)) {
      if (RESERVED_FIELDS.has(name)) {
        return latch(timingFailure(TEST_TIMING_CODES.TIMING_RECORD_INVALID,
          `timing record field ${name} is reserved`, { path: filePath, producer_id: producerId }));
      }
    }
    const record = { schema: TIMING_RECORD_SCHEMA, run_id: runId, producer_id: producerId,
      seq: sequence + 1, wall_ms: Date.now(), mono_ms: clock(), ...fields };
    let bytes;
    try {
      bytes = encodeTimingRecord(record);
    } catch (error) {
      return latch(error.code ? error : timingFailure(TEST_TIMING_CODES.TIMING_RECORD_INVALID,
        `timing record could not be encoded: ${error.message}`,
        { path: filePath, producer_id: producerId, seq: record.seq }));
    }
    try {
      for (let offset = 0; offset < bytes.length;) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset);
        if (written <= 0) throw new Error("timing journal write made no progress");
        offset += written;
      }
    } catch (error) {
      return latch(timingFailure(TEST_TIMING_CODES.ARTIFACT_WRITE_FAILED,
        `timing journal write failed: ${error.message}`,
        { path: filePath, producer_id: producerId, seq: record.seq, errno: error.code ?? null }));
    }
    sequence = record.seq;
    return null;
  }

  function close() {
    if (fd === null) return;
    const owned = fd;
    fd = null;
    try { closeSync(owned); } catch (error) { latch(error); }
  }

  return Object.freeze({
    path: filePath,
    producerId,
    append,
    close,
    get failure() { return failure; },
    get sequence() { return sequence; }
  });
}

export function readTimingJournal(filePath, { onRecord = () => {}, expectedRunId = null } = {}) {
  const errors = [];
  let trailing = null;
  let records = 0;
  let producerId = null;
  let lastSeq = 0;
  const reader = createBoundedLineReader({
    maxLineBytes: TIMING_MAX_RECORD_BYTES,
    eofPolicy: "report",
    onLine: (bytes, offset) => {
      let record;
      try {
        record = JSON.parse(DECODER.decode(bytes));
      } catch (error) {
        errors.push({ kind: "malformed", offset, message: error.message });
        return;
      }
      if (record?.schema !== TIMING_RECORD_SCHEMA || typeof record.producer_id !== "string" ||
          !Number.isSafeInteger(record.seq)) {
        errors.push({ kind: "malformed", offset, message: "record lacks schema, producer or sequence" });
        return;
      }
      if (expectedRunId !== null && record.run_id !== expectedRunId) {
        errors.push({ kind: "foreign_run", offset, seq: record.seq, run_id: record.run_id });
        return;
      }
      if (producerId === null) producerId = record.producer_id;
      else if (record.producer_id !== producerId) {
        errors.push({ kind: "foreign_producer", offset, seq: record.seq, producer_id: record.producer_id });
        return;
      }
      if (record.seq !== lastSeq + 1) {
        errors.push({ kind: "sequence_break", offset, expected: lastSeq + 1, seq: record.seq });
      }
      lastSeq = record.seq;
      records += 1;
      onRecord(record);
    },
    onFailure: (failure) => {
      errors.push({ kind: failure.kind === "consumer" ? "consumer" : "oversize", offset: failure.offset,
        message: failure.error?.message ?? `line of ${failure.bytes} bytes exceeds the record bound` });
    },
    onTrailing: ({ offset, bytes }) => {
      trailing = { offset, bytes: bytes.length, raw_base64: bytes.subarray(0, 4096).toString("base64") };
    }
  });
  let fd;
  try {
    fd = openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    return Object.freeze({ path: filePath, readable: false, error: error.message,
      records: 0, errors: Object.freeze([]), trailing: null, producer_id: null, last_seq: 0 });
  }
  try {
    const chunk = Buffer.alloc(READ_CHUNK_BYTES);
    while (true) {
      const read = readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      reader.push(Buffer.from(chunk.subarray(0, read)));
    }
    reader.end();
  } finally {
    closeSync(fd);
  }
  return Object.freeze({ path: filePath, readable: true, records, errors: Object.freeze(errors),
    trailing, producer_id: producerId, last_seq: lastSeq });
}
