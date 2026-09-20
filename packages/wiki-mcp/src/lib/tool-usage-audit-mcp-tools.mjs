import { types } from "node:util";
import {
  buildAnonymousMetric,
  projectElapsedMicros,
  projectHourBucket
} from "./tool-usage-audit/anonymous-metrics.mjs";
import { measureJsonBytes } from "./tool-usage-audit/json-byte-measurement.mjs";

const NOT_RETURNED = Object.freeze({ status: "not_returned", bytes: null });

function defaultMonotonicNs() {
  return process.hrtime.bigint();
}

function readClock(read) {
  try {
    return read();
  } catch {
    return null;
  }
}

function isReturnedError(result) {
  if (result === null || typeof result !== "object" || types.isProxy(result)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(result, "isError");
  return descriptor !== undefined && "value" in descriptor && descriptor.value === true;
}

export function createToolUsageAuditBoundaryRecorder({
  writer = null,
  monotonicNs = defaultMonotonicNs,
  now = () => new Date()
} = {}) {
  const registeredToolNames = new Set();

  function record({ toolName, wallClock, startNs, endNs, request, outcome, response }) {
    try {
      const metric = buildAnonymousMetric({
        tool: toolName,
        registeredToolNames,
        hour: projectHourBucket(wallClock),
        outcome,
        elapsed: projectElapsedMicros(startNs, endNs),
        request,
        response
      });
      if (metric === null) {
        writer.countHealth("invalid_record");
        return;
      }
      writer.enqueue(metric);
    } catch {
      try {
        writer.countHealth("measurement_failed");
      } catch {

      }
    }
  }

  async function observeToolCall({ toolName, args, handler, extra = undefined }) {
    if (typeof handler !== "function") throw new Error("tool-usage audit boundary handler must be a function");
    if (writer === null) {
      return handler(args, extra);
    }

    const request = measureJsonBytes(args);
    const wallClock = readClock(now);
    const startNs = readClock(monotonicNs);
    let result;
    try {
      result = await handler(args, extra);
    } catch (error) {
      const endNs = readClock(monotonicNs);
      record({ toolName, wallClock, startNs, endNs, request, outcome: "threw", response: NOT_RETURNED });
      throw error;
    }
    const endNs = readClock(monotonicNs);
    let outcome = "returned";
    let response;
    try {
      outcome = isReturnedError(result) ? "returned_error" : "returned";
      response = measureJsonBytes(result);
    } catch {
      response = { status: "measurement_failed", bytes: null };
    }
    record({ toolName, wallClock, startNs, endNs, request, outcome, response });
    return result;
  }

  function wrapHandler(toolName, handler) {
    registeredToolNames.add(toolName);
    return async (args, extra) => observeToolCall({ toolName, args, extra, handler });
  }

  return Object.freeze({ observeToolCall, wrapHandler });
}
