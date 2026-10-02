import path from "node:path";
import { access, readFile } from "node:fs/promises";
import {
  sanitizeWorkRecordDispatchOptions,
  WorkRecordDispatchInvalidOptionError,
  validateWorkRecordDispatchById,
  validateWorkRecordDispatchReportById
} from "../lib/work-record-dispatch.mjs";
import {
  applyWorkerScopePreflightOverlay,
  buildTerminalReadiness,
  createDefaultReadinessState
} from "../lib/work-record-dispatch-readiness-shape.mjs";
import { loadWorkRecordById } from "../lib/work-record-store.mjs";
import {
  CONTROLLED_ACCEPTANCE_DECISION_CODES,
  classifyControlledAcceptanceStateOperation
} from "./controlled-contract/controlled-acceptance-state-operations.mjs";
import { coverageUnitAddress } from "../lib/controlled-contract-unit-address.mjs";

const DISPATCH_READINESS_AXIS_AMBIGUOUS = "dispatch_readiness_axis_ambiguous";

export const VALIDATE_DISPATCH_QUESTION = Object.freeze({
  schema_version: "validate-dispatch-question.v1",
  answers: "well_formed",
  question: "Is the saved unit, and the saved contract it names, internally coherent and complete as a document?",
  decided_from: Object.freeze([
    "the canonical work record or slice",
    "its authenticated proof posture",
    "the saved controlled-contract carriers that posture names"
  ]),
  never_considered: Object.freeze([
    "installed proof providers, selectors, falsifier targets, runners or executors",
    "registry, catalog or evaluator execution capability",
    "whether a selected proof can execute in the current environment"
  ]),
  fulfillment_question: "Can the current world satisfy what the document says?",
  fulfillment_owner: "workspace_verify_proof"
});

const WELL_FORMEDNESS_BLOCKED_REASON_CODES = Object.freeze([
  "controlled_acceptance_disposition_missing",
  "controlled_acceptance_incomplete",
  "controlled_acceptance_source_not_current"
]);
const WELL_FORMEDNESS_BLOCKED_STAGES = Object.freeze([
  null, "authored_inputs", "canonical_sources"
]);

export const DISPATCH_QUESTION_BOUNDARY_CODE = "dispatch_readiness_fulfillment_fact_refused";

export class DispatchQuestionBoundaryError extends Error {
  constructor(details) {
    super("workspace_validate_dispatch answers well-formedness only; a fulfillment fact reached its boundary");
    this.name = "DispatchQuestionBoundaryError";
    this.code = DISPATCH_QUESTION_BOUNDARY_CODE;
    this.changed = false;
    this.details = Object.freeze({ ...details, question: VALIDATE_DISPATCH_QUESTION });
  }
}

export function assertWellFormednessOnlyAdmission(admission, { wkId = null, unit = null } = {}) {
  if (admission === null || typeof admission !== "object") {
    throw new DispatchQuestionBoundaryError({ wk_id: wkId, unit,
      observed: "the controlled-acceptance projection published no admission verdict" });
  }
  const violations = [];
  if (!WELL_FORMEDNESS_BLOCKED_STAGES.includes(admission.blocked_stage ?? null)) {
    violations.push({ field: "blocked_stage", observed_value: admission.blocked_stage,
      permitted_values: WELL_FORMEDNESS_BLOCKED_STAGES });
  }
  if (admission.admits !== true &&
      !WELL_FORMEDNESS_BLOCKED_REASON_CODES.includes(admission.blocked_reason_code)) {
    violations.push({ field: "blocked_reason_code", observed_value: admission.blocked_reason_code,
      permitted_values: WELL_FORMEDNESS_BLOCKED_REASON_CODES });
  }
  const operations = admission.unavailable_operations ?? [];
  if (operations.length > 0) {
    violations.push({ field: "unavailable_operations", observed_value: operations.length,
      permitted_values: [0] });
  }
  if (violations.length === 0) return admission;
  throw new DispatchQuestionBoundaryError({ wk_id: wkId, unit, violations,
    fulfillment_owner: VALIDATE_DISPATCH_QUESTION.fulfillment_owner,
    operator_action: "Report the owner that produced this verdict; it published an execution-capability fact on a well-formedness boundary." });
}

export { WORKER_SCOPE_PATH_REFUSED_DECISION_CODE } from "../lib/work-record-dispatch-readiness-shape.mjs";

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

function selectedSliceId(unitAddress) {
  return String(unitAddress ?? "").split("#")[1] || null;
}

function selectedSlice(record, unitAddress) {
  const sliceId = selectedSliceId(unitAddress);
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
  const readiness = buildTerminalReadiness({
    recordId: unitRecordId(unitAddress),
    unit: unitAddress || null,
    state: createDefaultReadinessState(null),
    decisionCode: DISPATCH_READINESS_AXIS_AMBIGUOUS,
    reason: reasonText,
    dispatchRole: "implementation"
  });
  return {
    ...readiness,
    dispatch_role: null,
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

const AGENT_DISPATCH_ROLE_BY_INTENDED_AGENT_ROLE = Object.freeze(
  Object.assign(Object.create(null), {
    worker: "worker",
    decision_worker: "worker",
    orchestrator: "worker",
    reviewer: "reviewer",
    redteam: "redteam"
  })
);

export function deriveAgentDispatchRole(subject, unitAddress) {
  const intendedRole = subject?.dispatch_intent?.intended_agent_role;
  const role = Object.prototype.hasOwnProperty.call(
    AGENT_DISPATCH_ROLE_BY_INTENDED_AGENT_ROLE,
    intendedRole
  ) ? AGENT_DISPATCH_ROLE_BY_INTENDED_AGENT_ROLE[intendedRole] : undefined;
  if (role === undefined) {
    return { refusal: refuseDerivedAxis({ subject, value: intendedRole ?? null, unitAddress }) };
  }
  return { role };
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

async function controlledAcceptanceReadiness(options, dispatchRole) {
  if (dispatchRole !== "implementation") return null;
  const loaded = await loadDispatchRecord(options);
  if (!loaded?.valid) return null;
  const subject = selectedSlice(loaded.record, options.unitAddress);
  if (subject?.work_kind !== "implementation") return null;

  const selectedUnit = selectedSliceId(options.unitAddress);
  let controlledAcceptanceState;
  try {
    controlledAcceptanceState = await classifyControlledAcceptanceStateOperation({
      repoRoot: path.resolve(String(options.dir)),
      wkId: loaded.record.id,
      selectedUnit,
      record: loaded.record
    });
  } catch (error) {
    const readiness = buildTerminalReadiness({
      recordId: loaded.record.id,
      unit: options.unitAddress,
      state: createDefaultReadinessState(null),
      decisionCode: CONTROLLED_ACCEPTANCE_DECISION_CODES.invalid,
      reason: error?.message ?? "controlled-acceptance proof posture is invalid",
      dispatchRole
    });
    return { refusal: { ...readiness,
      controlled_acceptance_state: null,
      controlled_acceptance_refusal: {
        schema_version: "controlled-acceptance-structural-refusal.v1",
        code: error?.code ?? CONTROLLED_ACCEPTANCE_DECISION_CODES.invalid,
        source_code: error?.code ?? null,
        source_details: error?.details ?? null,
        changed: false,
        wk_id: loaded.record.id,
        selected_unit: selectedUnit
      },
      next_calls: [{
        tool: "workspace_validate_proof",
        arguments: { unit: coverageUnitAddress({ wkId: loaded.record.id,
          selectedUnit }) },
        recommended: true
      }] } };
  }

  assertWellFormednessOnlyAdmission(controlledAcceptanceState.semantic.admission,
    { wkId: loaded.record.id, unit: options.unitAddress });
  if (controlledAcceptanceState.semantic.admission.admits) {
    return { controlledAcceptanceState };
  }
  const admission = controlledAcceptanceState.semantic.admission;
  const decisionCode = admission.blocked_reason_code ??
    CONTROLLED_ACCEPTANCE_DECISION_CODES[controlledAcceptanceState.state];

  const coverageExplanation = admission.deciding_causes.some(
    (cause) => cause.cause === "acceptance_criteria_uncovered")
    ? admission.recovery_explanation : null;
  const readiness = buildTerminalReadiness({
    recordId: loaded.record.id,
    unit: options.unitAddress,
    state: createDefaultReadinessState(null),
    decisionCode,
    reason: controlledAcceptanceState.state === "absent"
      ? "the canonical proof posture has no controlled-acceptance disposition"
      : decisionCode === "controlled_acceptance_source_not_current"
        ? "the authenticated controlled-acceptance source moved during assessment"
        : coverageExplanation ?? controlledAcceptanceState.recovery?.explanation ??
          "the current required controlled-acceptance contract is mechanically incomplete",
    dispatchRole
  });
  const recovery = controlledAcceptanceState.recovery;
  const recoveryContract = recovery === null ? null : Object.freeze({
    ...recovery,
    selected_unit: controlledAcceptanceState.semantic.selected_unit.address,
    deciding_cause: decisionCode,
    recovery_actor: admission.recovery_capability.actor_recovery,
    operator_action: admission.operator_action,
    fresh_cas: recovery.follow_up_tool ===
      "workspace_controlled_contract_obligation_coverage_upsert"
      ? Object.freeze({
          required: true,
          source: "query.content_digest",
          argument: "expected_content_digest"
        })
      : null,
    deciding_causes: admission.deciding_causes,
    authority: Object.freeze({
      decision: "authored_completeness_admission",
      observations: "nonblocking"
    })
  });
  return { controlledAcceptanceState, refusal: { ...readiness,
    controlled_acceptance_state: controlledAcceptanceState,
    controlled_acceptance_recovery: recoveryContract,
    next_calls: typeof recovery?.tool === "string" ? [recovery] : [] } };
}

const DISPATCH_REPORT_OPTION_KEYS = Object.freeze([

  "worker_scope_preflight",
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
  "suppress_live_graph_resolution",
  "graph_preparation_failure"
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

    graph_preparation_failure:
      source.graph_preparation_failure === undefined ? null : source.graph_preparation_failure,
    worker_scope_preflight:
      source.worker_scope_preflight === undefined ? null : source.worker_scope_preflight,
    now
  };
}

async function workerScopePreflightFor(options, dispatchRole) {
  const preflight = options.worker_scope_preflight;
  if (typeof preflight !== "function" || dispatchRole !== "implementation") return null;
  if (options.recordStore !== null) {
    return {
      status: "not_evaluated",
      reason: { code: "record_store_not_live", message: null },
      evaluated: []
    };
  }
  const report = await preflight({ dir: options.dir, unitAddress: options.unitAddress });
  if (report === null || typeof report !== "object" || typeof report.status !== "string") {
    throw new TypeError("worker scope preflight returned a malformed report");
  }
  return report.status === "not_applicable" ? null : report;
}

function withoutTrustedSeams(options) {
  const { worker_scope_preflight: _preflight, ...rest } = options;
  return rest;
}

export async function validateWorkRecordDispatch(options = {}) {
  const picked = pickDispatchOptions(
    options,
    DISPATCH_STRICT_OPTION_KEYS,
    "validateWorkRecordDispatch"
  );
  const snapshotOptions = withoutTrustedSeams(withSnapshotRecordStore(picked));
  const axis = await selectDispatchAxis(snapshotOptions);
  if (axis.refusal) return axis.refusal;
  const controlledAcceptance = await controlledAcceptanceReadiness(
    snapshotOptions,
    axis.dispatch_role
  );
  if (controlledAcceptance?.refusal) return controlledAcceptance.refusal;
  const result = await validateWorkRecordDispatchById({
    ...snapshotOptions,
    dispatch_role: axis.dispatch_role
  });
  const preflight = await workerScopePreflightFor(picked, axis.dispatch_role);
  return applyWorkerScopePreflightOverlay({
    ...attachCarrierDiagnostic(result, axis.carrierRefusal),
    ...(controlledAcceptance?.controlledAcceptanceState === undefined ? {} : {
      controlled_acceptance_state: controlledAcceptance.controlledAcceptanceState
    })
  }, preflight);
}

export async function validateWorkRecordDispatchReport(options = {}) {
  const picked = pickDispatchOptions(
    options,
    DISPATCH_REPORT_OPTION_KEYS,
    "validateWorkRecordDispatchReport"
  );
  const { mode: _unusedMode, ...rest } = withoutTrustedSeams(withSnapshotRecordStore(picked));
  const axis = await selectDispatchAxis(rest);
  if (axis.refusal) return { report_mode: true, readiness: axis.refusal };
  const controlledAcceptance = await controlledAcceptanceReadiness(rest, axis.dispatch_role);
  if (controlledAcceptance?.refusal) {
    return { report_mode: true, readiness: controlledAcceptance.refusal };
  }
  const result = await validateWorkRecordDispatchReportById({
    ...rest,
    dispatch_role: axis.dispatch_role
  });
  const preflight = await workerScopePreflightFor(picked, axis.dispatch_role);
  return {
    ...result,
    readiness: applyWorkerScopePreflightOverlay({
      ...attachCarrierDiagnostic(result.readiness, axis.carrierRefusal),
      ...(controlledAcceptance?.controlledAcceptanceState === undefined ? {} : {
        controlled_acceptance_state: controlledAcceptance.controlledAcceptanceState
      })
    }, preflight)
  };
}
