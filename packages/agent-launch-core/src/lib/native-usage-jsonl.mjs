
import { types } from "node:util";

export const NATIVE_USAGE_JSONL_MAX_LINE_BYTES = 1048576;

const LF = 0x0a;
const CR = 0x0d;
const INITIAL_CAPACITY = 4096;

function refusal(ErrorType, code, message) {
  const error = new ErrorType(message);
  error.code = code;
  return error;
}

function readCallbacks(options) {
  const invalid = () => refusal(TypeError, "native_usage_jsonl_invalid_options",
    "native usage JSONL decoder options must be a plain object with only onRecord and onDiagnostic data properties");
  if (options === null || typeof options !== "object" || Array.isArray(options)) throw invalid();
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) throw invalid();
  const descriptors = {};
  for (const key of Reflect.ownKeys(options)) {
    if (key !== "onRecord" && key !== "onDiagnostic") throw invalid();
    descriptors[key] = Object.getOwnPropertyDescriptor(options, key);
    if (!Object.hasOwn(descriptors[key], "value")) throw invalid();
  }
  if (typeof descriptors.onRecord?.value !== "function") {
    throw refusal(TypeError, "native_usage_jsonl_invalid_on_record",
      "native usage JSONL decoder requires an onRecord function");
  }
  if (typeof descriptors.onDiagnostic?.value !== "function") {
    throw refusal(TypeError, "native_usage_jsonl_invalid_on_diagnostic",
      "native usage JSONL decoder requires an onDiagnostic function");
  }
  return { onRecord: descriptors.onRecord.value, onDiagnostic: descriptors.onDiagnostic.value };
}

export function createNativeUsageJsonlDecoder(options) {
  const { onRecord, onDiagnostic } = readCallbacks(options);
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let state = "open";
  let completion = null;
  let terminal = null;
  let busy = false;
  let line = 1;
  let records = 0;
  let diagnostics = 0;

  let pending = null;
  let pendingBytes = 0;
  let discarding = false;

  const snapshot = () => Object.freeze({
    state,
    complete: state === "open" ? null : state === "finished" && completion === true && diagnostics === 0,
    records,
    diagnostics,
    pendingBytes,
    discarding
  });

  function release() {
    pending = null;
    pendingBytes = 0;
  }

  function settle(next) {
    state = next;
    release();
    discarding = false;
    terminal = snapshot();
    return terminal;
  }

  function deliver(callback, argument) {
    try {
      callback(argument);
    } catch (thrown) {
      settle("failed");
      throw thrown;
    }
  }

  function diagnose(code) {
    diagnostics += 1;
    deliver(onDiagnostic, { code, line });
  }

  function decodeLine(bytes) {
    const end = bytes.length > 0 && bytes[bytes.length - 1] === CR ? bytes.length - 1 : bytes.length;
    if (end === 0) return;
    let code = "invalid_utf8";
    let value;
    try {
      const text = decoder.decode(end === bytes.length ? bytes : bytes.subarray(0, end));
      code = "invalid_json";
      value = JSON.parse(text);
    } catch {
      diagnose(code);
      return;
    }
    deliver(onRecord, { line, value });
    records += 1;
  }

  function own(chunk, offset, length) {
    const needed = pendingBytes + length;
    if (pending === null || pending.length < needed) {
      const grown = new Uint8Array(Math.min(NATIVE_USAGE_JSONL_MAX_LINE_BYTES,
        Math.max(needed, (pending?.length ?? 0) * 2, INITIAL_CAPACITY)));
      if (pendingBytes > 0) grown.set(pending.subarray(0, pendingBytes));
      pending = grown;
    }
    pending.set(chunk.subarray(offset, offset + length), pendingBytes);
    pendingBytes = needed;
  }

  function consume(chunk) {
    let offset = 0;
    while (offset < chunk.length) {
      const lf = chunk.indexOf(LF, offset);
      const end = lf === -1 ? chunk.length : lf;
      const length = end - offset;
      if (!discarding && pendingBytes + length > NATIVE_USAGE_JSONL_MAX_LINE_BYTES) {
        release();
        discarding = true;
        diagnose("line_too_large");
      }
      if (discarding) {
        if (lf === -1) return;
        discarding = false;
      } else if (lf === -1) {
        own(chunk, offset, length);
        return;
      } else if (pendingBytes === 0) {
        decodeLine(chunk.subarray(offset, end));
      } else {
        own(chunk, offset, length);
        const bytes = pending.subarray(0, pendingBytes);
        pending = null;
        pendingBytes = 0;
        decodeLine(bytes);
      }
      line += 1;
      offset = lf + 1;
    }
  }

  function refuseReentry() {
    if (busy) {
      throw refusal(Error, "native_usage_jsonl_reentrant_call",
        "native usage JSONL decoder push and finish cannot be called from its own callbacks");
    }
  }

  function push(chunk) {
    if (!types.isUint8Array(chunk)) {
      throw refusal(TypeError, "native_usage_jsonl_invalid_chunk",
        "native usage JSONL decoder push requires a Buffer or Uint8Array");
    }
    refuseReentry();
    if (state === "failed") {
      throw refusal(Error, "native_usage_jsonl_failed",
        "native usage JSONL decoder failed in a callback and accepts no more input");
    }
    if (state === "finished") {
      throw refusal(Error, "native_usage_jsonl_finished", "native usage JSONL decoder is finished and accepts no more input");
    }
    busy = true;
    try {
      consume(chunk);
    } finally {
      busy = false;
    }
    return undefined;
  }

  function finish(complete) {
    if (typeof complete !== "boolean") {
      throw refusal(TypeError, "native_usage_jsonl_invalid_completion",
        "native usage JSONL decoder finish requires a boolean completion observation");
    }
    refuseReentry();
    if (state === "failed") return terminal;
    if (state === "finished") {
      if (complete === completion) return terminal;
      throw refusal(Error, "native_usage_jsonl_finish_conflict",
        "native usage JSONL decoder was already finished with the other completion observation");
    }
    busy = true;
    try {
      const residue = discarding || pendingBytes === 0 ? null : pending.subarray(0, pendingBytes);
      release();
      if (complete) {
        if (residue !== null) decodeLine(residue);
      } else {
        if (residue !== null) diagnose("truncated_record");
        diagnose("source_incomplete");
      }
      completion = complete;
      return settle("finished");
    } finally {
      busy = false;
    }
  }

  return Object.freeze({ push, finish, getState: snapshot });
}
