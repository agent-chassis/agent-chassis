import { isDeepStrictEqual, types } from "node:util";
import {
  evaluateSuccessPredicate,
  isMachineCheckableSuccessPredicate
} from "@agent-chassis/wiki-core/src/lib/next-calls-descriptor.mjs";
import {
  buildAnonymousMetric,
  buildTrajectoryRecord,
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

const ROUTER_TOOL = "workspace_tool_router_recommend";

function ownData(target, key) {
  if (target === null || typeof target !== "object" || types.isProxy(target)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function plainJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function extractNextCallDescriptor(toolName, result) {
  const structured = ownData(result, "structuredContent");
  const refusal = ownData(structured, "refusal");
  const refusalCalls = ownData(refusal, "next_calls");
  const ownCalls = ownData(structured, "next_calls");
  const modeledFailure = isReturnedError(result) ||
    (ownData(structured, "status") === "not_executable" &&
      ownData(ownData(structured, "observation"), "kind") !== "retained_prior_observation");
  const [correlation, calls] = Array.isArray(refusalCalls) && refusalCalls.length > 0
    ? ["refusal_replacement", refusalCalls]
    : Array.isArray(ownCalls) && ownCalls.length > 0
      ? [toolName === ROUTER_TOOL ? "router_recommendation"
        : modeledFailure ? "refusal_replacement" : "emitted_next_calls", ownCalls]
      : [null, null];
  if (correlation === null) return null;
  const projected = plainJson(calls.map((entry) => ({
    tool: ownData(entry, "tool"),
    arguments: ownData(entry, "arguments") ?? {},
    recommended: ownData(entry, "recommended") === true,
    disallowed: ownData(entry, "disallowed") === true,
    success_predicate: ownData(entry, "success_predicate") ?? null
  })));
  return Array.isArray(projected) ? { correlation, calls: projected } : null;
}

function publishedFacts(result) {
  const structured = ownData(result, "structuredContent");
  const facts = ownData(structured, "observed_facts") ?? ownData(ownData(structured, "refusal"), "observed_facts");
  return facts !== null && typeof facts === "object" && !Array.isArray(facts) ? plainJson(facts) ?? null : null;
}

function classifyTrajectory(descriptor, toolName, args, result) {
  if (descriptor === null) return { correlation: "none", trajectory: "unobserved" };
  const callArguments = plainJson(args ?? {}) ?? {};
  const match = descriptor.calls.find((entry) => entry.tool === toolName &&
    isDeepStrictEqual(entry.arguments, callArguments));
  const { correlation } = descriptor;
  if (correlation === "refusal_replacement") {
    if (match === undefined || match.disallowed) return { correlation, trajectory: "ignored_recommendation" };
    if (!isMachineCheckableSuccessPredicate(match.success_predicate)) {
      return { correlation, trajectory: "refusal_recovery_unassessed" };
    }
    const outcome = evaluateSuccessPredicate(match.success_predicate, publishedFacts(result));
    return { correlation, trajectory: outcome === true ? "refusal_recovered"
      : outcome === false ? "refusal_not_recovered" : "refusal_recovery_unassessed" };
  }
  if (match !== undefined && !match.disallowed) {
    return { correlation, trajectory: match.recommended ? "followed" : "allowed_alternative" };
  }
  return { correlation, trajectory: correlation === "router_recommendation"
    ? "wrong_first_tool" : "ignored_recommendation" };
}

export function createToolUsageAuditBoundaryRecorder({
  writer = null,
  monotonicNs = defaultMonotonicNs,
  now = () => new Date()
} = {}) {
  const registeredToolNames = new Set();

  let previousDescriptor = null;
  let inFlight = 0;
  let overlapped = false;

  function recordTrajectory({ toolName, wallClock, concurrent, args, result }) {

    if (!registeredToolNames.has(toolName)) return;
    try {
      const observed = concurrent
        ? { correlation: previousDescriptor?.correlation ?? "none", trajectory: "concurrent_unknown" }
        : classifyTrajectory(previousDescriptor, toolName, args, result);
      const record = buildTrajectoryRecord({ tool: toolName, registeredToolNames,
        hour: projectHourBucket(wallClock), ...observed });
      if (record === null) writer.countHealth("invalid_record");
      else writer.enqueue(record);
    } catch {
      try {
        writer.countHealth("measurement_failed");
      } catch {

      }
    }
  }

  function settleTrajectory({ toolName, concurrent, result }) {
    inFlight -= 1;
    if (concurrent || overlapped) {
      previousDescriptor = null;
      if (inFlight === 0) overlapped = false;
      return;
    }
    try {
      previousDescriptor = result === undefined ? null : extractNextCallDescriptor(toolName, result);
    } catch {
      previousDescriptor = null;
    }
  }

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
    const concurrent = inFlight > 0;
    if (concurrent) overlapped = true;
    inFlight += 1;
    let result;
    try {
      result = await handler(args, extra);
    } catch (error) {
      const endNs = readClock(monotonicNs);
      record({ toolName, wallClock, startNs, endNs, request, outcome: "threw", response: NOT_RETURNED });
      recordTrajectory({ toolName, wallClock, concurrent: concurrent || overlapped, args, result: undefined });
      settleTrajectory({ toolName, concurrent, result: undefined });
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
    recordTrajectory({ toolName, wallClock, concurrent: concurrent || overlapped, args, result });
    settleTrajectory({ toolName, concurrent, result });
    return result;
  }

  function wrapHandler(toolName, handler) {
    registeredToolNames.add(toolName);
    return async (args, extra) => observeToolCall({ toolName, args, extra, handler });
  }

  return Object.freeze({ observeToolCall, wrapHandler });
}
