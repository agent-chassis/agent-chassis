import path from "node:path";
import {
  validateWorkRecordDispatchById,
  validateWorkRecordDispatchReportById
} from "../lib/work-record-dispatch.mjs";

const DISPATCH_REPORT_OPTION_KEYS = Object.freeze([
  "dir",
  "unitAddress",
  "dispatch_role",
  "recordStore",
  "graph_state",
  "graph_impact",
  "graph_import_adjacency",
  "dependency_statuses",
  "preparation_audit",
  "policy_result",
  "node_engine_admissibility",
  "now"
]);

const DISPATCH_STRICT_OPTION_KEYS = Object.freeze([...DISPATCH_REPORT_OPTION_KEYS, "mode"]);

function pickDispatchOptions(input, allowedKeys, callerName) {
  const source = input == null ? {} : input;
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(source).filter((key) => !allowed.has(key));
  if (unknown.length) {
    unknown.sort();
    throw new Error(
      `${callerName} does not accept option(s): ${unknown.join(", ")}`
    );
  }

  const now = source.now === undefined ? new Date().toISOString() : source.now;
  return {
    dir: path.resolve(String(source.dir === undefined ? "." : source.dir)),
    unitAddress: source.unitAddress,
    mode: source.mode === undefined ? "strict" : source.mode,
    dispatch_role: source.dispatch_role === undefined ? "implementation" : source.dispatch_role,
    recordStore: source.recordStore === undefined ? null : source.recordStore,
    graph_state: source.graph_state === undefined ? null : source.graph_state,
    graph_impact: source.graph_impact === undefined ? null : source.graph_impact,
    graph_import_adjacency:
      source.graph_import_adjacency === undefined ? null : source.graph_import_adjacency,
    dependency_statuses: source.dependency_statuses === undefined ? null : source.dependency_statuses,
    preparation_audit: source.preparation_audit === undefined ? null : source.preparation_audit,
    policy_result: source.policy_result === undefined ? null : source.policy_result,

    node_engine_admissibility:
      source.node_engine_admissibility === undefined ? null : source.node_engine_admissibility,
    now
  };
}

export async function validateWorkRecordDispatch(options = {}) {
  const picked = pickDispatchOptions(
    options,
    DISPATCH_STRICT_OPTION_KEYS,
    "validateWorkRecordDispatch"
  );
  return validateWorkRecordDispatchById(picked);
}

export async function validateWorkRecordDispatchReport(options = {}) {
  const picked = pickDispatchOptions(
    options,
    DISPATCH_REPORT_OPTION_KEYS,
    "validateWorkRecordDispatchReport"
  );
  const { mode: _unusedMode, ...rest } = picked;
  return validateWorkRecordDispatchReportById(rest);
}
