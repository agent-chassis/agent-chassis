import path from "node:path";
import { access, readFile } from "node:fs/promises";
import {
  sanitizeWorkRecordDispatchOptions,
  WorkRecordDispatchInvalidOptionError,
  validateWorkRecordDispatchById,
  validateWorkRecordDispatchReportById
} from "../lib/work-record-dispatch.mjs";
import { loadWorkRecordById } from "../lib/work-record-store.mjs";

const DISPATCH_READINESS_AXIS_AMBIGUOUS = "dispatch_readiness_axis_ambiguous";

const DERIVED_DISPATCH_ROLE_BY_INTENDED_AGENT_ROLE = Object.freeze(
  Object.assign(Object.create(null), {
    worker: "implementation",
    reviewer: "read_only",
    redteam: "read_only",
    decision_worker: "implementation",
    orchestrator: "implementation"
  })
);

function unitRecordId(unitAddress) {
  const match = /^([^#]+)(?:#.*)?$/.exec(String(unitAddress ?? ""));
  return match?.[1] || null;
}

function selectedSlice(record, unitAddress) {
  const sliceId = String(unitAddress ?? "").split("#")[1] || null;
  if (!sliceId) return record;
  return Array.isArray(record?.slices)
    ? record.slices.find((slice) => slice?.id === sliceId) ?? null
    : null;
}

export async function loadDispatchSubject({ dir = ".", unitAddress, recordStore = null } = {}) {
  const loaded = await loadDispatchRecord({ dir, unitAddress, recordStore });
  if (!loaded?.valid) return null;
  return selectedSlice(loaded.record, unitAddress);
}

async function loadDispatchRecord({ dir = ".", unitAddress, recordStore = null } = {}) {
  const id = unitRecordId(unitAddress);
  if (!id) return null;
  return loadWorkRecordById({ dir, id, recordStore });
}

function axisRefusal({ value, reason, unitAddress = null }) {
  const observedValue = value === undefined ? "<missing>" : value;
  const reasonText = reason === "intended_agent_role_null"
    ? "dispatch_intent.intended_agent_role is null, meaning no direct role dispatch is intended, so no readiness axis can be inferred."
    : reason === "derived_read_only_implementation_guard"
      ? "a derived read_only axis is contradictory for an implementation unit; supply an explicit dispatch_role."
      : `the observed dispatch_intent.intended_agent_role value ${JSON.stringify(observedValue)} does not map to an implementation or read_only readiness axis.`;
  return {
    schema_version: "dispatch-readiness.v1",
    ...(unitAddress ? { unit: unitAddress } : {}),
    decision_code: DISPATCH_READINESS_AXIS_AMBIGUOUS,
    dispatchable: false,
    dispatch_role: null,
    reasons: [reasonText],
    axis_refusal: {
      reason,
      observed_field: "dispatch_intent.intended_agent_role",
      observed_value: value,
      remediation: {
        action: "supply_explicit_dispatch_role",
        argument: "dispatch_role",
        accepted_values: ["implementation", "read_only"]
      }
    }
  };
}

function hasOwnProperty(target, key) {
  return (
    target !== null &&
    typeof target === "object" &&
    Object.prototype.hasOwnProperty.call(target, key)
  );
}

function suppliedStoreVouchesForLiveWorktree(recordStore) {
  if (!hasOwnProperty(recordStore, "capabilities")) return false;
  const capabilities = recordStore.capabilities;
  if (!hasOwnProperty(capabilities, "live_worktree")) return false;
  return capabilities.live_worktree === true;
}

function snapshotRecordStore({ dir, recordStore }) {
  const existsByPath = new Map();
  const textByPath = new Map();

  const live = recordStore === null || recordStore === undefined
    ? true
    : suppliedStoreVouchesForLiveWorktree(recordStore);
  const source = recordStore ?? {
    async pathExists(filePath) {
      try {
        await access(path.resolve(dir, filePath));
        return true;
      } catch (error) {
        if (error?.code === "ENOENT") return false;
        throw error;
      }
    },
    async readText(filePath) {
      return readFile(path.resolve(dir, filePath), "utf8");
    }
  };
  return {

    ...(live ? { capabilities: Object.freeze({ live_worktree: true }) } : {}),
    async pathExists(filePath) {
      if (!existsByPath.has(filePath)) {

        existsByPath.set(filePath, Promise.resolve().then(() => source.pathExists(filePath)));
      }
      return await existsByPath.get(filePath);
    },
    async readText(filePath) {
      if (!textByPath.has(filePath)) {

        textByPath.set(filePath, Promise.resolve().then(() => source.readText(filePath)));
      }
      return await textByPath.get(filePath);
    }
  };
}

function invalidCarrierDiagnostic(value, unitAddress) {
  return axisRefusal({
    value,
    reason: "intended_agent_role_has_no_readiness_axis",
    unitAddress
  });
}

export function refuseDerivedAxis({ subject, value, unitAddress = null } = {}) {
  const intendedRole = value === undefined
    ? subject?.dispatch_intent?.intended_agent_role
    : value;
  const mappedRole = Object.prototype.hasOwnProperty.call(
    DERIVED_DISPATCH_ROLE_BY_INTENDED_AGENT_ROLE,
    intendedRole
  ) ? DERIVED_DISPATCH_ROLE_BY_INTENDED_AGENT_ROLE[intendedRole] : undefined;
  const reason = intendedRole === null
    ? "intended_agent_role_null"
    : mappedRole === "read_only" && subject?.work_kind === "implementation"
      ? "derived_read_only_implementation_guard"
      : "intended_agent_role_has_no_readiness_axis";
  return axisRefusal({
    value: intendedRole,
    reason,
    unitAddress
  });
}

export function deriveDispatchRole(subject, unitAddress) {
  const intendedRole = subject?.dispatch_intent?.intended_agent_role;
  if (intendedRole === null) {
    return { refusal: refuseDerivedAxis({ subject, value: intendedRole, unitAddress }) };
  }
  const role = Object.prototype.hasOwnProperty.call(
    DERIVED_DISPATCH_ROLE_BY_INTENDED_AGENT_ROLE,
    intendedRole
  ) ? DERIVED_DISPATCH_ROLE_BY_INTENDED_AGENT_ROLE[intendedRole] : undefined;
  if (role === undefined) {
    return { refusal: refuseDerivedAxis({ subject, value: intendedRole, unitAddress }) };
  }
  if (role === "read_only" && subject?.work_kind === "implementation") {
    return {
      refusal: axisRefusal({
        value: intendedRole,
        reason: "derived_read_only_implementation_guard",
        unitAddress
      })
    };
  }
  return { dispatch_role: role };
}

async function selectDispatchAxis(source) {

  const loaded = await loadDispatchRecord(source);
  const invalidAuthoredRole = loaded?.valid
    ? undefined
    : loaded?.record?.dispatch_intent?.intended_agent_role;
  const carrierRefusal = Object.prototype.hasOwnProperty.call(
    DERIVED_DISPATCH_ROLE_BY_INTENDED_AGENT_ROLE,
    invalidAuthoredRole
  ) || invalidAuthoredRole === null || invalidAuthoredRole === undefined
    ? null
    : invalidCarrierDiagnostic(invalidAuthoredRole, source.unitAddress);
  if (source.dispatch_role !== undefined) {
    return { dispatch_role: source.dispatch_role, carrierRefusal };
  }

  if (!loaded?.valid) return { dispatch_role: "implementation", carrierRefusal };
  const subject = selectedSlice(loaded.record, source.unitAddress);
  if (subject === null) return { dispatch_role: "implementation", carrierRefusal };
  return deriveDispatchRole(subject, source.unitAddress);
}

function withSnapshotRecordStore(options) {
  return {
    ...options,
    recordStore: snapshotRecordStore(options)
  };
}

function attachCarrierDiagnostic(result, carrierRefusal) {
  if (!carrierRefusal) return result;
  return {
    ...result,
    axis_refusal: carrierRefusal.axis_refusal
  };
}

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

const DISPATCH_STRICT_OPTION_KEYS = Object.freeze([
  ...DISPATCH_REPORT_OPTION_KEYS,
  "mode",
  "suppress_live_graph_resolution"
]);

function pickDispatchOptions(input, allowedKeys, callerName) {
  const source = sanitizeWorkRecordDispatchOptions(input, allowedKeys, callerName);

  if (
    source.mode === "report-only" &&
    Object.prototype.hasOwnProperty.call(source, "suppress_live_graph_resolution")
  ) {
    throw new WorkRecordDispatchInvalidOptionError(
      callerName,
      ["suppress_live_graph_resolution"],
      {
        message:
          `${callerName} does not accept suppress_live_graph_resolution in report-only mode (strict-mode only)`
      }
    );
  }

  const now = source.now === undefined ? new Date().toISOString() : source.now;
  return {
    dir: path.resolve(String(source.dir === undefined ? "." : source.dir)),
    unitAddress: source.unitAddress,
    mode: source.mode === undefined ? "strict" : source.mode,

    dispatch_role: source.dispatch_role,
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

    suppress_live_graph_resolution: source.suppress_live_graph_resolution === true,
    now
  };
}

export async function validateWorkRecordDispatch(options = {}) {
  const picked = pickDispatchOptions(
    options,
    DISPATCH_STRICT_OPTION_KEYS,
    "validateWorkRecordDispatch"
  );
  const snapshotOptions = withSnapshotRecordStore(picked);
  const axis = await selectDispatchAxis(snapshotOptions);
  if (axis.refusal) return axis.refusal;
  const result = await validateWorkRecordDispatchById({
    ...snapshotOptions,
    dispatch_role: axis.dispatch_role
  });
  return attachCarrierDiagnostic(result, axis.carrierRefusal);
}

export async function validateWorkRecordDispatchReport(options = {}) {
  const picked = pickDispatchOptions(
    options,
    DISPATCH_REPORT_OPTION_KEYS,
    "validateWorkRecordDispatchReport"
  );
  const { mode: _unusedMode, ...rest } = withSnapshotRecordStore(picked);
  const axis = await selectDispatchAxis(rest);
  if (axis.refusal) return { report_mode: true, readiness: axis.refusal };
  const result = await validateWorkRecordDispatchReportById({
    ...rest,
    dispatch_role: axis.dispatch_role
  });
  return {
    ...result,
    readiness: attachCarrierDiagnostic(result.readiness, axis.carrierRefusal)
  };
}
