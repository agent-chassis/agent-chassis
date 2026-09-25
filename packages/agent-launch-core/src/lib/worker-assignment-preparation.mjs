

import {
  mergeReadScopeRefs
} from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import {
  projectWorkRecordTestProofValidation
} from "@agent-chassis/wiki-core/src/lib/work-record-test-proof-bindings.mjs";

import {
  renderWorkRecordAgentBrief
} from "@agent-chassis/wiki-core/src/lib/work-record-renderer.mjs";
import { buildWorkRecordLaunchPacket, parseWorkRecordUnitAddress } from "./work-record-gate.mjs";

export const WORKER_ASSIGNMENT_PRESENTATION_SCHEMA_VERSION =
  "worker-assignment-presentation.v1";

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function stringList(value) {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

function operativeTasks(unit) {
  const tasks = Array.isArray(unit?.sections?.tasks) ? unit.sections.tasks : [];
  return tasks
    .map((task) => (isNonEmptyString(task?.text)
      ? { text: task.text, status: isNonEmptyString(task.status) ? task.status : null }
      : null))
    .filter((task) => task !== null);
}

function selectedSliceContract(record, sliceId) {
  if (!isNonEmptyString(sliceId) || !Array.isArray(record?.slices)) return null;
  return record.slices.find((slice) => slice && slice.id === sliceId) || null;
}

export function buildWorkerAssignmentScopePresentation({
  record,
  unit,
  mode = "declared",
  resolvedScope = null,
  exclusions = []
} = {}) {
  const selectedSlice = selectedSliceContract(record, unit?.slice_id ?? null);
  const declaredUnit = selectedSlice ?? record;
  if (mode === "declared") {
    const readScope = mergeReadScopeRefs(declaredUnit);
    const repoPaths = stringList(declaredUnit?.repo_paths);
    const writable = stringList(declaredUnit?.write_scope);
    return Object.freeze({
      provenance: "declared",
      readable: Object.freeze([...new Set([...readScope, ...repoPaths, ...writable])]),
      writable: Object.freeze([...new Set(writable)]),
      exclusions: Object.freeze(stringList(exclusions))
    });
  }
  if (mode !== "managed_resolved" || !isObject(resolvedScope) ||
      !isObject(resolvedScope.readable) || !isObject(resolvedScope.writable)) {
    throw new Error("managed worker assignment requires authenticated resolved scope membership");
  }
  const members = (scope) => [
    ...stringList(scope.files),
    ...stringList(scope.directories)
  ];
  const writable = members(resolvedScope.writable);
  const readable = [...new Set([...members(resolvedScope.readable), ...writable])];
  return Object.freeze({
    provenance: "managed_resolved",
    readable: Object.freeze(readable),
    writable: Object.freeze([...new Set(writable)]),
    exclusions: Object.freeze([...new Set(stringList(exclusions))])
  });
}

export function buildWorkerAssignmentCanonicalSummary(
  record,
  readiness,
  unit,
  { scopePresentation = null } = {}
) {
  const selectedSlice = selectedSliceContract(record, unit?.slice_id ?? null);
  const presentedScope = scopePresentation ?? buildWorkerAssignmentScopePresentation({
    record,
    unit,
    mode: "declared"
  });

  const selectedUnit = selectedSlice
    ? {
        id: selectedSlice.id,
        title: selectedSlice.title,
        work_kind: selectedSlice.work_kind,
        status: selectedSlice.status,
        docs: mergeReadScopeRefs(selectedSlice),
        repo_paths: Array.isArray(selectedSlice.repo_paths) ? selectedSlice.repo_paths : [],
        write_scope: Array.isArray(selectedSlice.write_scope) ? selectedSlice.write_scope : [],
        acceptance: selectedSlice.acceptance || null,
        dispatch_intent: selectedSlice.dispatch_intent || null
      }
    : null;
  const validationProjection = projectWorkRecordTestProofValidation({
    selectedUnit: selectedUnit ?? record
  });
  if (validationProjection.status !== "valid") {
    throw new Error("worker admission requires valid current acceptance.validation declarations");
  }
  const operativeUnit = selectedSlice ?? record;

  return {
    record_id: record.id,
    repo: record.repo,
    title: record.title,
    docs: presentedScope.readable,
    repo_paths: [],
    write_scope: presentedScope.writable,
    scope_presentation: presentedScope,
    acceptance_criteria: selectedUnit
      ? Array.isArray(selectedUnit.acceptance?.criteria)
        ? selectedUnit.acceptance.criteria
        : []
      : Array.isArray(record.acceptance?.criteria)
        ? record.acceptance.criteria
        : [],
    validation_commands: validationProjection.validation_entries,

    operative_tasks: operativeTasks(operativeUnit),
    operative_notes: isNonEmptyString(operativeUnit?.sections?.agent_notes)
      ? operativeUnit.sections.agent_notes
      : null,
    dispatch_intent: selectedUnit ? selectedUnit.dispatch_intent : record.dispatch_intent || null,
    selected_unit: selectedUnit,
    accepted_escalations: Array.isArray(readiness.accepted_escalations) ? readiness.accepted_escalations : [],
    canonical_refs: Array.isArray(readiness.canonical_refs) ? readiness.canonical_refs : [],
    derived_evidence: Array.isArray(readiness.derived_evidence) ? readiness.derived_evidence : [],
    state: readiness.state || null
  };
}

export function buildWorkerAssignmentBrief({
  record,
  sliceId = null,
  entryMaterial = null,
  generatedAt = undefined,
  outputPath = undefined,
  scopePresentation = null
} = {}) {
  return renderWorkRecordAgentBrief(record, {
    ...(generatedAt === undefined ? {} : { generatedAt }),
    ...(outputPath === undefined ? {} : { outputPath }),
    sliceId,
    entryMaterial,
    scopePresentation
  });
}

function presentationDiagnostic(code, message, detail = null) {
  return Object.freeze({
    code,
    message,
    authority_limb: "mechanical_failure",
    ...(detail === null ? {} : { detail })
  });
}

export const WORKER_ASSIGNMENT_PROJECTION_INVALID_CODE = "worker_assignment_projection_invalid";

function normalizeAssignmentReadiness(readiness, unit) {
  const source = isObject(readiness) ? readiness : {};
  const sourceUnit = isObject(source.unit) ? source.unit : {};
  const list = (value) => (Array.isArray(value) ? value : []);
  return {
    ...source,
    schema_version: "dispatch-readiness.v1",
    decision_code: isNonEmptyString(source.decision_code) ? source.decision_code : "dispatchable",
    dispatchable: source.dispatchable !== false,
    record_id: isNonEmptyString(source.record_id) ? source.record_id : unit.record_id,
    unit: {
      ...sourceUnit,
      kind: isNonEmptyString(sourceUnit.kind) ? sourceUnit.kind : unit.kind,
      address: isNonEmptyString(sourceUnit.address) ? sourceUnit.address : unit.address,
      record_id: isNonEmptyString(sourceUnit.record_id) ? sourceUnit.record_id : unit.record_id,
      slice_id: sourceUnit.slice_id === undefined ? unit.slice_id : sourceUnit.slice_id
    },
    reasons: list(source.reasons).filter(isNonEmptyString),
    validation_hints: list(source.validation_hints).filter(isNonEmptyString),
    canonical_refs: list(source.canonical_refs),
    derived_evidence: list(source.derived_evidence)
  };
}

function collectReachable(value, into) {
  if (value === null || typeof value !== "object" || into.has(value)) return into;
  into.add(value);
  for (const child of Object.values(value)) collectReachable(child, into);
  return into;
}

function freezeOwnedGraph(value, foreign, frozen) {
  if (value === null || typeof value !== "object") return value;
  if (foreign.has(value) || frozen.has(value)) return value;
  frozen.add(value);
  for (const child of Object.values(value)) freezeOwnedGraph(child, foreign, frozen);
  return Object.freeze(value);
}

export function prepareWorkerAssignmentPresentation({
  role,
  unitAddress,
  record,
  readiness,
  sourceDigest,
  entryMaterial = null,
  launchTimestamp,
  supplementalInstructions = [],
  terminalStructuredRoleResultMode = undefined,
  generatedAt = undefined,
  outputPath = undefined,
  scopeMode = "declared",
  resolvedScope = null,
  scopeExclusions = []
} = {}) {
  const parsedUnit = parseWorkRecordUnitAddress(unitAddress);
  if (!parsedUnit.ok) {
    return Object.freeze({
      ok: false,
      diagnostic: presentationDiagnostic(
        WORKER_ASSIGNMENT_PROJECTION_INVALID_CODE,
        `worker assignment unit address is invalid: ${unitAddress}`
      )
    });
  }
  if (!isObject(record) || !isNonEmptyString(record.id)) {
    return Object.freeze({
      ok: false,
      diagnostic: presentationDiagnostic(
        WORKER_ASSIGNMENT_PROJECTION_INVALID_CODE,
        "worker assignment requires the canonical work record"
      )
    });
  }
  const unit = parsedUnit.value;
  if (unit.record_id !== record.id) {
    return Object.freeze({
      ok: false,
      diagnostic: presentationDiagnostic(
        WORKER_ASSIGNMENT_PROJECTION_INVALID_CODE,
        `worker assignment record ${record.id} does not match unit ${unit.address}`
      )
    });
  }
  if (unit.slice_id !== null && selectedSliceContract(record, unit.slice_id) === null) {
    return Object.freeze({
      ok: false,
      diagnostic: presentationDiagnostic(
        WORKER_ASSIGNMENT_PROJECTION_INVALID_CODE,
        `worker assignment selected slice ${unit.slice_id} is absent from ${record.id}`
      )
    });
  }

  const presentedReadiness = normalizeAssignmentReadiness(readiness, unit);
  let canonicalSummary;
  let agentBrief;
  try {
    const scopePresentation = buildWorkerAssignmentScopePresentation({
      record,
      unit,
      mode: scopeMode,
      resolvedScope,
      exclusions: scopeExclusions
    });
    canonicalSummary = buildWorkerAssignmentCanonicalSummary(record, presentedReadiness, unit, {
      scopePresentation
    });
    agentBrief = buildWorkerAssignmentBrief({
      record,
      sliceId: unit.slice_id,
      entryMaterial,
      generatedAt,
      outputPath,
      scopePresentation
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      diagnostic: presentationDiagnostic(
        WORKER_ASSIGNMENT_PROJECTION_INVALID_CODE,
        error?.message ?? String(error)
      )
    });
  }
  if (agentBrief?.valid !== true || !isNonEmptyString(agentBrief.brief)) {
    return Object.freeze({
      ok: false,
      diagnostic: presentationDiagnostic(
        WORKER_ASSIGNMENT_PROJECTION_INVALID_CODE,
        "worker assignment brief projection is unavailable",
        { diagnostics: agentBrief?.diagnostics ?? [] }
      )
    });
  }

  const normalizedBrief = { brief: agentBrief.brief, projection: agentBrief.projection };
  const launchPacket = buildWorkRecordLaunchPacket({
    role,
    unitAddress: unit.address,
    readiness: presentedReadiness,
    sourceDigest,
    canonicalSummary,
    agentBrief: normalizedBrief,
    launchTimestamp,
    supplementalInstructions: stringList(supplementalInstructions),
    terminalStructuredRoleResultMode
  });

  if (!isNonEmptyString(launchPacket?.prompt)) {
    return Object.freeze({
      ok: false,
      diagnostic: presentationDiagnostic(
        WORKER_ASSIGNMENT_PROJECTION_INVALID_CODE,
        "worker assignment launch packet could not be composed",
        { diagnostics: launchPacket?.diagnostics ?? [] }
      )
    });
  }

  const foreign = new WeakSet();
  for (const input of [record, readiness, entryMaterial, supplementalInstructions]) {
    collectReachable(input, foreign);
  }
  return freezeOwnedGraph({
    ok: true,
    schema_version: WORKER_ASSIGNMENT_PRESENTATION_SCHEMA_VERSION,
    unit_address: unit.address,
    record_id: unit.record_id,
    slice_id: unit.slice_id,
    role,
    source_digest: launchPacket.source_digest,
    terminal_result_mode: terminalStructuredRoleResultMode ?? null,
    canonical_summary: canonicalSummary,
    agent_brief: normalizedBrief,
    launch_packet: launchPacket,
    prompt: launchPacket.prompt
  }, foreign, new WeakSet());
}
