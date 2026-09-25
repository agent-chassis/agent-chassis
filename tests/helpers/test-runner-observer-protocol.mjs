

export const OBSERVER_PROTOCOL_VERSION = 2;
export const OBSERVER_MAX_FRAME_BYTES = 16 * 1024;
export const OBSERVER_RECORDING_MESSAGE_MAX = 1024;

export const OBSERVER_FRAME_FIELDS = Object.freeze({
  HELLO: Object.freeze(["type", "v"]),
  FILE_START: Object.freeze(["file", "id", "type", "v"]),
  FILE_END: Object.freeze(["file", "id", "outcome", "type", "v"]),

  RECORDING_FAILURE: Object.freeze(["code", "message", "type", "v"]),
  STREAM_END: Object.freeze(["type", "v"])
});

const DECODER = new TextDecoder("utf-8", { fatal: true });

function exactKeys(frame, expected) {
  const names = Object.keys(frame).sort();
  return names.length === expected.length &&
    expected.every((name, index) => name === names[index]);
}

export class ObserverProtocolViolation extends Error {
  constructor(message) {
    super(message);
    this.name = "ObserverProtocolViolation";
  }
}

function violation(message) {
  return new ObserverProtocolViolation(message);
}

export function encodeObserverFrame(fields) {
  const frame = { v: OBSERVER_PROTOCOL_VERSION, ...fields };
  validateObserverFrame(frame);
  const bytes = Buffer.from(`${JSON.stringify(frame)}\n`, "utf8");
  if (bytes.length > OBSERVER_MAX_FRAME_BYTES) {
    throw violation("observer frame exceeded its protocol bound");
  }
  return bytes;
}

export function validateObserverFrame(frame) {
  if (frame === null || typeof frame !== "object" || Array.isArray(frame) ||
      frame.v !== OBSERVER_PROTOCOL_VERSION || typeof frame.type !== "string") {
    throw violation("observer frame has an invalid version or shape");
  }
  const keys = Object.hasOwn(OBSERVER_FRAME_FIELDS, frame.type)
    ? OBSERVER_FRAME_FIELDS[frame.type] : undefined;
  if (keys === undefined || !exactKeys(frame, keys)) {
    throw violation("observer frame has unknown type or fields");
  }
  if (frame.type === "FILE_START" || frame.type === "FILE_END") {
    if (typeof frame.file !== "string" || !Number.isSafeInteger(frame.id) || frame.id < 0 ||
        frame.type === "FILE_END" && !["pass", "fail"].includes(frame.outcome)) {
      throw violation("observer file identity or outcome is invalid");
    }
  }
  if (frame.type === "RECORDING_FAILURE") {
    if (typeof frame.code !== "string" || !/^test_runner\.[a-z_]+\.v1$/u.test(frame.code) ||
        typeof frame.message !== "string" ||
        frame.message.length > OBSERVER_RECORDING_MESSAGE_MAX) {
      throw violation("observer recording failure is invalid");
    }
  }
  return frame;
}

export function decodeObserverFrame(bytes) {
  if (bytes.length === 0 || bytes.length + 1 > OBSERVER_MAX_FRAME_BYTES) {
    throw violation("empty or oversized observer frame");
  }
  let frame;
  try {
    frame = JSON.parse(DECODER.decode(bytes));
  } catch (error) {
    throw violation(`observer frame is not UTF-8 JSON: ${error.message}`);
  }
  return validateObserverFrame(frame);
}
