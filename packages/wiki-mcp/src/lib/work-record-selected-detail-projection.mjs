

import path from "node:path";
import { types as utilTypes } from "node:util";
import { SLICE_ID_PATTERN } from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import { parseWorkRecordSummaryUnit } from "@agent-chassis/wiki-core/src/lib/work-record-summary.mjs";
import { projectSelectedWorkRecordUnit } from "@agent-chassis/wiki-core/src/lib/work-record-selected-unit-projection.mjs";

export const WORK_RECORD_ID_PATTERN = /^WK-[0-9]{4}$/;
export const WORK_RECORD_ID_PREFIX_PATTERN = /^WK-/;
const WORK_RECORD_READ_PATH_PATTERN = /^(?:\.\/)?wiki\/work-records\/(WK-[0-9]{4})\.json$/;
const GRAPH_EVIDENCE_READ_PATH_PATTERN =
  /^(?:\.\/)?wiki\/work-records\/evidence\/(WK-[0-9]{4})\.graph\.json$/;
const WORK_RECORD_NAMESPACE_CLAIM_PATTERN =
  /^(?:\.\/)?wiki\/+work-records(?:\/|$)/;
const GRAPH_EVIDENCE_NAMESPACE_CLAIM_PATTERN =
  /^(?:\.\/)?wiki\/+work-records\/+evidence(?:\/|$)/;

function isObject(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    !utilTypes.isProxy(value) &&
    !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export const IDENTITY_REFUSAL_SCHEMA_VERSION = "work-record-selected-identity-refusal.v1";
export const IDENTITY_REFUSAL_CODE = "selected_result_identity_mismatch";

export function throwSelectedIdentityError(toolFamily) {
  const message = `${toolFamily} selected result identity did not match the requested selector`;
  const diagnostics = [{
    code: IDENTITY_REFUSAL_CODE,
    severity: "error",
    path: [],
    message
  }];
  const error = new Error(message);
  error.name = "WorkRecordSelectedIdentityError";
  error.code = IDENTITY_REFUSAL_CODE;
  error.diagnostics = diagnostics;
  error.envelope = {
    schema_version: IDENTITY_REFUSAL_SCHEMA_VERSION,
    tool: toolFamily,
    accepted: false,
    refusal_code: IDENTITY_REFUSAL_CODE,
    diagnostics
  };
  throw error;
}

export function extractWorkRecordReadPath(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const match = normalized.match(WORK_RECORD_READ_PATH_PATTERN);
  return match
    ? { kind: "work_record", path: normalized, record_id: match[1] }
    : null;
}

export function extractGraphEvidenceReadPath(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const match = normalized.match(GRAPH_EVIDENCE_READ_PATH_PATTERN);
  return match
    ? { kind: "graph_evidence", path: normalized, record_id: match[1] }
    : null;
}

export function classifyReadPagePath(value) {
  const normalized = normalizeString(value);
  if (!normalized) return { kind: "invalid", path: null, record_id: null };
  const graphEvidence = extractGraphEvidenceReadPath(normalized);
  if (graphEvidence) return graphEvidence;
  const workRecord = extractWorkRecordReadPath(normalized);
  if (workRecord) return workRecord;
  const normalizedClaimPath = path.posix.normalize(normalized);
  if (
    GRAPH_EVIDENCE_NAMESPACE_CLAIM_PATTERN.test(normalized) ||
    normalizedClaimPath === "wiki/work-records/evidence" ||
    normalizedClaimPath.startsWith("wiki/work-records/evidence/")
  ) {
    return { kind: "malformed_graph_evidence", path: normalized, record_id: null };
  }
  if (
    WORK_RECORD_NAMESPACE_CLAIM_PATTERN.test(normalized) ||
    normalizedClaimPath === "wiki/work-records" ||
    normalizedClaimPath.startsWith("wiki/work-records/")
  ) {
    return { kind: "malformed_work_record", path: normalized, record_id: null };
  }
  return { kind: "generic", path: normalized, record_id: null };
}

export function isSafeWorkspaceRelativePath(value) {
  const normalized = normalizeString(value);
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/")) return false;
  const posix = normalized.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(posix)) return false;
  return !posix.split("/").includes("..");
}

export function isWorkRecordReadPath(value) {
  return extractWorkRecordReadPath(value) !== null;
}

export function isGraphEvidenceReadPath(value) {
  return extractGraphEvidenceReadPath(value) !== null;
}

const INVALID_DATA_PROPERTY = Symbol("invalid-data-property");
const MAX_IDENTITY_PROJECTION_NODES = 10000;
const MAX_IDENTITY_PROJECTION_DEPTH = 64;
const IDENTITY_CHILD_FIELDS = ["selected_unit", "unit", "identity"];
const PROJECTED_IDENTITY_CONTAINER_FIELDS = [
  "acceptance",
  "dispatch_intent",
  "sections",
  "activity_artifact_targets",
  "scenarios",
  "expected_edit_targets",
  "expected",
  "closure"
];
const PROJECTED_GRAPH_CONTAINER_FIELDS = ["graph_state", "counts", "degraded_state"];

function ownDataProperty(value, field) {
  if (value && typeof value === "object" && utilTypes.isProxy(value)) {
    return { present: true, value: INVALID_DATA_PROPERTY };
  }
  if (!value || typeof value !== "object") {
    return { present: false, value: undefined };
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor) return { present: false, value: undefined };
  if (!Object.hasOwn(descriptor, "value")) {
    return { present: true, value: INVALID_DATA_PROPERTY };
  }
  return { present: true, value: descriptor.value };
}

function requiredDataProperty(value, field) {
  const property = ownDataProperty(value, field);
  return property.present && property.value !== INVALID_DATA_PROPERTY
    ? property.value
    : INVALID_DATA_PROPERTY;
}

function projectSelectedUnit(value) {
  if (!isObject(value)) return null;
  const kind = requiredDataProperty(value, "kind");
  const address = requiredDataProperty(value, "address");
  const recordId = requiredDataProperty(value, "record_id");
  const sliceId = requiredDataProperty(value, "slice_id");
  if ([kind, address, recordId, sliceId].includes(INVALID_DATA_PROPERTY)) return null;
  return {
    kind,
    address,
    record_id: recordId,
    slice_id: sliceId
  };
}

function recordIdFromReadPath(value) {
  return extractWorkRecordReadPath(value)?.record_id ??
    extractGraphEvidenceReadPath(value)?.record_id ??
    null;
}

export function requestedSummaryIdentity(selector) {
  const identity = parseWorkRecordSummaryUnit(selector?.selected);
  return identity?.kind === "slice" ? identity : null;
}

function requestedReadIdentity(selector) {
  const recordId = selector?.id
    ? normalizeString(selector.id)
    : recordIdFromReadPath(selector?.path);
  if (!recordId || !WORK_RECORD_ID_PATTERN.test(recordId)) return null;
  const sliceId = selector?.selected_slice ?? null;
  if (sliceId !== null && !SLICE_ID_PATTERN.test(sliceId)) return null;
  return {
    kind: sliceId === null ? "work_item" : "slice",
    address: sliceId === null ? recordId : `${recordId}#${sliceId}`,
    record_id: recordId,
    slice_id: sliceId
  };
}

function exactIdentityStringMatches(value, expected) {

  return typeof value === "string" && value === expected;
}

function selectedSliceIdValueMatches(value, expectedSliceId) {
  return expectedSliceId === null
    ? value === null
    : exactIdentityStringMatches(value, expectedSliceId);
}

function selectedUnitIdentityMatches(value, expected) {
  if (!isObject(value) || !expected) return false;
  const kind = requiredDataProperty(value, "kind");
  const address = requiredDataProperty(value, "address");
  const recordId = requiredDataProperty(value, "record_id");
  const sliceId = requiredDataProperty(value, "slice_id");
  if ([kind, address, recordId, sliceId].includes(INVALID_DATA_PROPERTY)) return false;
  const selectedSliceId = ownDataProperty(value, "selected_slice_id");
  if (selectedSliceId.value === INVALID_DATA_PROPERTY) return false;
  return (
    kind === expected.kind &&
    exactIdentityStringMatches(address, expected.address) &&
    exactIdentityStringMatches(recordId, expected.record_id) &&
    (expected.slice_id === null
      ? sliceId === null
      : exactIdentityStringMatches(sliceId, expected.slice_id)) &&
    (!selectedSliceId.present ||
      selectedSliceIdValueMatches(selectedSliceId.value, expected.slice_id))
  );
}

function optionalPathIdentityMatches(value, expected) {
  for (const field of ["relativePath", "source_path_relative"]) {
    const property = ownDataProperty(value, field);
    if (!property.present) continue;
    if (
      property.value === INVALID_DATA_PROPERTY ||
      typeof property.value !== "string" ||
      property.value !== property.value.trim() ||
      recordIdFromReadPath(property.value) !== expected.record_id
    ) {
      return false;
    }
  }
  return true;
}

function directIdentityCarriersMatch(value, expected) {
  if (!isObject(value) || !expected) return false;
  const recordId = ownDataProperty(value, "record_id");
  const selectedSliceId = ownDataProperty(value, "selected_slice_id");
  const sliceId = ownDataProperty(value, "slice_id");
  const address = ownDataProperty(value, "address");
  for (const property of [recordId, selectedSliceId, sliceId, address]) {
    if (property.value === INVALID_DATA_PROPERTY) return false;
  }
  if (recordId.present && !exactIdentityStringMatches(recordId.value, expected.record_id)) {
    return false;
  }
  if (selectedSliceId.present && !selectedSliceIdValueMatches(selectedSliceId.value, expected.slice_id)) {
    return false;
  }
  if (sliceId.present) {
    if (
      expected.slice_id === null
        ? sliceId.value !== null
        : !exactIdentityStringMatches(sliceId.value, expected.slice_id)
    ) {
      return false;
    }
  }
  if (address.present && !exactIdentityStringMatches(address.value, expected.address)) {
    return false;
  }
  return optionalPathIdentityMatches(value, expected);
}

function validateRecognizedIdentityTree(roots, expected) {
  const stack = [];
  for (let index = 0; index < roots.length; index += 1) {
    stack.push({ value: roots[index], boundary: true, deep: false, root: true, depth: 0 });
  }
  const seen = new WeakSet();
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    const value = current.value;
    if (!value || typeof value !== "object" || utilTypes.isProxy(value)) return false;
    if (current.depth > MAX_IDENTITY_PROJECTION_DEPTH || nodes >= MAX_IDENTITY_PROJECTION_NODES) {
      return false;
    }
    if (seen.has(value)) return false;
    seen.add(value);
    nodes += 1;

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const entry = ownDataProperty(value, String(index));
        if (!entry.present || entry.value === INVALID_DATA_PROPERTY) return false;
        if (entry.value && typeof entry.value === "object") {
          stack.push({
            value: entry.value,
            boundary: true,
            deep: current.deep,
            root: false,
            depth: current.depth + 1
          });
        }
      }
      continue;
    }

    if (current.boundary && !directIdentityCarriersMatch(value, expected)) return false;
    for (const field of IDENTITY_CHILD_FIELDS) {
      const child = ownDataProperty(value, field);
      if (!child.present) continue;
      if (
        child.value === INVALID_DATA_PROPERTY ||
        !selectedUnitIdentityMatches(child.value, expected)
      ) {
        return false;
      }
      stack.push({
        value: child.value,
        boundary: true,
        deep: false,
        root: false,
        depth: current.depth + 1
      });
    }

    const graphRef = ownDataProperty(value, "graph_impact_summary_ref");
    if (graphRef.present) {
      if (graphRef.value === INVALID_DATA_PROPERTY || !isObject(graphRef.value)) return false;
      stack.push({
        value: graphRef.value,
        boundary: true,
        deep: true,
        root: false,
        depth: current.depth + 1
      });
    }

    if (current.root) {
      for (const field of PROJECTED_IDENTITY_CONTAINER_FIELDS) {
        const child = ownDataProperty(value, field);
        if (!child.present) continue;
        if (child.value === INVALID_DATA_PROPERTY) return false;
        if (child.value && typeof child.value === "object") {
          stack.push({
            value: child.value,
            boundary: true,
            deep: field !== "sections",
            root: false,
            sections: field === "sections",
            depth: current.depth + 1
          });
        }
      }
      for (const field of PROJECTED_GRAPH_CONTAINER_FIELDS) {
        const child = ownDataProperty(value, field);
        if (!child.present) continue;
        if (child.value === INVALID_DATA_PROPERTY) return false;
        if (child.value && typeof child.value === "object") {
          stack.push({
            value: child.value,
            boundary: true,
            deep: false,
            root: false,
            depth: current.depth + 1
          });
        }
      }
    }

    if (current.deep) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (const [field, descriptor] of Object.entries(descriptors)) {
        if (!descriptor.enumerable) continue;
        if (!Object.hasOwn(descriptor, "value")) return false;
        if (IDENTITY_CHILD_FIELDS.includes(field) || field === "graph_impact_summary_ref") {
          continue;
        }
        if (descriptor.value && typeof descriptor.value === "object") {
          stack.push({
            value: descriptor.value,
            boundary: true,
            deep: true,
            root: false,
            depth: current.depth + 1
          });
        }
      }
    } else if (current.sections) {
      const agentNotes = ownDataProperty(value, "agent_notes");
      if (agentNotes.value === INVALID_DATA_PROPERTY) return false;
      if (agentNotes.present && agentNotes.value && typeof agentNotes.value === "object") {
        stack.push({
          value: agentNotes.value,
          boundary: true,
          deep: true,
          root: false,
          depth: current.depth + 1
        });
      }
    }
  }
  return true;
}

function validateCompletedProjectionIdentity(value, expected) {
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    const entry = current.value;
    if (!entry || typeof entry !== "object" || utilTypes.isProxy(entry)) return false;
    if (current.depth > MAX_IDENTITY_PROJECTION_DEPTH || nodes >= MAX_IDENTITY_PROJECTION_NODES) {
      return false;
    }
    if (seen.has(entry)) return false;
    seen.add(entry);
    nodes += 1;

    if (!Array.isArray(entry) && !directIdentityCarriersMatch(entry, expected)) return false;
    for (const field of IDENTITY_CHILD_FIELDS) {
      const identity = ownDataProperty(entry, field);
      if (!identity.present) continue;
      if (
        identity.value === INVALID_DATA_PROPERTY ||
        !selectedUnitIdentityMatches(identity.value, expected)
      ) {
        return false;
      }
    }

    const descriptors = Object.getOwnPropertyDescriptors(entry);
    for (const field of Object.keys(descriptors)) {
      const descriptor = descriptors[field];
      if (!descriptor.enumerable) continue;
      if (!Object.hasOwn(descriptor, "value")) return false;
      const child = descriptor.value;
      if (!child || typeof child !== "object") continue;
      if (utilTypes.isProxy(child)) return false;
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
}

function selectedEnvelopeIdentityMatches(value, expected) {
  if (!isObject(value) || !expected) return false;
  const recordId = requiredDataProperty(value, "record_id");
  if (
    recordId === INVALID_DATA_PROPERTY ||
    !exactIdentityStringMatches(recordId, expected.record_id) ||
    !directIdentityCarriersMatch(value, expected)
  ) {
    return false;
  }
  const roots = [value];
  const summary = ownDataProperty(value, "summary");
  if (summary.present && summary.value !== null) {
    if (summary.value === INVALID_DATA_PROPERTY || !isObject(summary.value)) return false;
    roots.push(summary.value);
  }
  return validateRecognizedIdentityTree(roots, expected);
}

export function projectSelectedSummaryResult(fullSummaryResult, requestedIdentity) {
  if (!selectedEnvelopeIdentityMatches(fullSummaryResult, requestedIdentity)) return null;
  const selectedUnitSourceProperty = ownDataProperty(fullSummaryResult, "selected_unit");
  if (
    !selectedUnitSourceProperty.present ||
    selectedUnitSourceProperty.value === INVALID_DATA_PROPERTY ||
    !selectedUnitIdentityMatches(selectedUnitSourceProperty.value, requestedIdentity)
  ) {
    return null;
  }
  const selectedUnit = projectSelectedUnit(selectedUnitSourceProperty.value);

  const summaryProperty = ownDataProperty(fullSummaryResult, "summary");
  let selectedUnitSource = null;
  if (summaryProperty.present && summaryProperty.value !== null) {
    if (summaryProperty.value === INVALID_DATA_PROPERTY || !isObject(summaryProperty.value)) {
      return null;
    }
    const selectedSummaryProperty = ownDataProperty(
      summaryProperty.value,
      "selected_unit_summary"
    );
    if (selectedSummaryProperty.present) {
      if (
        selectedSummaryProperty.value === INVALID_DATA_PROPERTY ||
        (selectedSummaryProperty.value !== null && !isObject(selectedSummaryProperty.value))
      ) {
        return null;
      }
      selectedUnitSource = selectedSummaryProperty.value;
    }
  }

  if (selectedUnitSource !== null) {
    const id = requiredDataProperty(selectedUnitSource, "id");
    if (
      id === INVALID_DATA_PROPERTY ||
      !exactIdentityStringMatches(id, requestedIdentity.slice_id) ||
      !validateRecognizedIdentityTree([selectedUnitSource], requestedIdentity)
    ) {
      return null;
    }
  }
  const selectedUnitSummary = selectedUnitSource === null
    ? null
    : projectSelectedWorkRecordUnit(selectedUnitSource);
  if (selectedUnitSource !== null && selectedUnitSummary === null) return null;
  const recordId = requiredDataProperty(fullSummaryResult, "record_id");
  const valid = ownDataProperty(fullSummaryResult, "valid");
  const result = {
    record_id: recordId,
    valid: valid.value === true && selectedUnitSummary !== null,
    selected_unit: selectedUnit,
    summary: selectedUnitSummary
  };

  if (selectedUnitSummary === null) {
    result.diagnostics = [
      {
        code: "missing_slice",
        severity: "error",
        message: `Selected slice ${requestedIdentity.slice_id} does not exist on the selected record`,
        path: "unit"
      }
    ];
  }
  return validateCompletedProjectionIdentity(result, requestedIdentity) ? result : null;
}

function copyGraphScalar(result, source, field, predicate = () => true) {
  const property = ownDataProperty(source, field);
  if (!property.present) return true;
  if (property.value === INVALID_DATA_PROPERTY || !predicate(property.value)) return false;
  result[field] = property.value;
  return true;
}

function projectGraphStringList(source, field) {
  const property = ownDataProperty(source, field);
  if (!property.present) return { valid: true, present: false, value: undefined };
  if (
    property.value === INVALID_DATA_PROPERTY ||
    utilTypes.isProxy(property.value) ||
    !Array.isArray(property.value)
  ) {
    return { valid: false, present: true, value: undefined };
  }
  const value = [];
  for (let index = 0; index < property.value.length; index += 1) {
    const entry = ownDataProperty(property.value, String(index));
    if (!entry.present || entry.value === INVALID_DATA_PROPERTY || typeof entry.value !== "string") {
      return { valid: false, present: true, value: undefined };
    }
    value.push(entry.value);
  }
  return { valid: true, present: true, value };
}

function projectGraphState(value) {
  if (!isObject(value)) return null;
  const result = {};
  for (const field of [
    "graph_available",
    "dirty_state",
    "staleness",
    "edge_source",
    "dirty_graph_mode",
    "graph_schema_version",
    "unavailable_path_count"
  ]) {
    if (!copyGraphScalar(result, value, field, (entry) =>
      entry === null || ["string", "number", "boolean"].includes(typeof entry)
    )) {
      return null;
    }
  }
  return result;
}

function projectNumericCounts(value) {
  if (!isObject(value)) return null;
  const result = {};
  for (const [field, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable) continue;
    if (!Object.hasOwn(descriptor, "value")) return null;
    if (typeof descriptor.value === "number" && Number.isFinite(descriptor.value)) {
      result[field] = descriptor.value;
    }
  }
  return result;
}

function projectDegradedState(value) {
  if (!isObject(value)) return null;
  const result = {};
  for (const field of ["kind", "code", "reason_code", "message"]) {
    if (!copyGraphScalar(result, value, field, (entry) =>
      entry === null || (typeof entry === "string" && entry.length <= 1000)
    )) {
      return null;
    }
  }
  return result;
}

function copyGraphIdentityFields(result, source) {
  for (const field of ["record_id", "slice_id", "selected_slice_id", "address"]) {
    if (!copyGraphScalar(result, source, field, (entry) => entry === null || typeof entry === "string")) {
      return false;
    }
  }
  for (const field of ["unit", "identity"]) {
    const property = ownDataProperty(source, field);
    if (!property.present) continue;
    if (property.value === INVALID_DATA_PROPERTY) return false;
    const identity = projectSelectedUnit(property.value);
    if (!identity) return false;
    result[field] = identity;
  }
  return true;
}

function projectGraphImpactSummaryRef(value) {
  if (!isObject(value)) return null;
  const result = {};
  if (!copyGraphIdentityFields(result, value)) return null;
  for (const field of [
    "kind",
    "replay_detail_available",
    "query_kind",
    "source_record_digest",
    "generated_at",
    "invalid_path_count",
    "raw_evidence_digest",
    "graph_entry_digest"
  ]) {
    if (!copyGraphScalar(result, value, field, (entry) =>
      entry === null || ["string", "number", "boolean"].includes(typeof entry)
    )) {
      return null;
    }
  }
  for (const field of ["input_paths", "validated_paths"]) {
    const projected = projectGraphStringList(value, field);
    if (!projected.valid) return null;
    if (projected.present) result[field] = projected.value;
  }
  for (const [field, projector] of [
    ["graph_state", projectGraphState],
    ["counts", projectNumericCounts],
    ["degraded_state", projectDegradedState]
  ]) {
    const property = ownDataProperty(value, field);
    if (!property.present) continue;
    if (property.value === INVALID_DATA_PROPERTY) return null;
    const projected = projector(property.value);
    if (projected === null) return null;
    result[field] = projected;
  }
  return result;
}

function projectPublicGraphEntry(value, envelope) {
  if (!isObject(value)) return null;
  const result = {};
  if (!copyGraphIdentityFields(result, value)) return null;
  for (const field of [
    "replay_detail_available",
    "query_kind",
    "source_record_digest",
    "generated_at",
    "invalid_path_count",
    "raw_evidence_digest",
    "graph_entry_digest"
  ]) {
    if (!copyGraphScalar(result, value, field, (entry) =>
      entry === null || ["string", "number", "boolean"].includes(typeof entry)
    )) {
      return null;
    }
  }
  if (!Object.hasOwn(result, "generated_at")) {
    const generatedAt = ownDataProperty(envelope, "generated_at");
    if (generatedAt.value === INVALID_DATA_PROPERTY) return null;
    if (generatedAt.present && (generatedAt.value === null || typeof generatedAt.value === "string")) {
      result.generated_at = generatedAt.value;
    }
  }
  for (const field of ["input_paths", "validated_paths"]) {
    const projected = projectGraphStringList(value, field);
    if (!projected.valid) return null;
    if (projected.present) result[field] = projected.value;
  }
  for (const [field, projector] of [
    ["graph_state", projectGraphState],
    ["counts", projectNumericCounts],
    ["degraded_state", projectDegradedState]
  ]) {
    const property = ownDataProperty(value, field);
    if (!property.present) continue;
    if (property.value === INVALID_DATA_PROPERTY) return null;
    const projected = projector(property.value);
    if (projected === null) return null;
    result[field] = projected;
  }
  const graphRef = ownDataProperty(value, "graph_impact_summary_ref");
  if (graphRef.present) {
    if (graphRef.value === INVALID_DATA_PROPERTY) return null;
    const projected = projectGraphImpactSummaryRef(graphRef.value);
    if (projected === null) return null;
    result.graph_impact_summary_ref = projected;
  }
  return result;
}

function projectSelectedSliceReadResult(compactResult, requestedIdentity) {
  const format = requiredDataProperty(compactResult, "format");
  if (format !== "json-work-record" && format !== "graph-evidence-sidecar") return null;
  if (
    !selectedEnvelopeIdentityMatches(compactResult, requestedIdentity) ||
    !selectedSliceIdValueMatches(
      requiredDataProperty(compactResult, "selected_slice_id"),
      requestedIdentity?.slice_id
    )
  ) {
    return null;
  }
  const selectedSlice = requiredDataProperty(compactResult, "selected_slice");
  const selectedSliceFoundValue = requiredDataProperty(compactResult, "selected_slice_found");
  if (typeof selectedSliceFoundValue !== "boolean") return null;
  const selectedSliceFound = selectedSliceFoundValue === true;
  if (selectedSliceFound !== isObject(selectedSlice)) return null;

  if (!selectedSliceFound) return null;
  if (selectedSliceFound) {
    const primaryIdentityMatches = format === "json-work-record"
      ? exactIdentityStringMatches(
          requiredDataProperty(selectedSlice, "id"),
          requestedIdentity.slice_id
        )
      : selectedUnitIdentityMatches(
          requiredDataProperty(selectedSlice, "unit"),
          requestedIdentity
        );
    if (!primaryIdentityMatches || !validateRecognizedIdentityTree([selectedSlice], requestedIdentity)) {
      return null;
    }
  }
  const recordId = requiredDataProperty(compactResult, "record_id");
  const selectedSliceId = requiredDataProperty(compactResult, "selected_slice_id");
  const projectedSlice = !selectedSliceFound
    ? null
    : format === "json-work-record"
      ? projectSelectedWorkRecordUnit(selectedSlice)
      : projectPublicGraphEntry(selectedSlice, compactResult);
  if (selectedSliceFound && projectedSlice === null) return null;
  const result = {
    format,
    record_id: recordId,
    selected_slice_id: selectedSliceId,
    selected_slice: projectedSlice,
    selected_slice_found: selectedSliceFound
  };

  if (format === "json-work-record") {
    result.valid = ownDataProperty(compactResult, "valid").value === true;
  }
  return validateCompletedProjectionIdentity(result, requestedIdentity) ? result : null;
}

function projectSelectedRecordReadResult(compactResult, requestedIdentity) {
  if (
    requiredDataProperty(compactResult, "format") !== "graph-evidence-sidecar" ||
    requiredDataProperty(compactResult, "selected_record") !== true ||
    !selectedEnvelopeIdentityMatches(compactResult, requestedIdentity)
  ) {
    return null;
  }
  const recordEntry = requiredDataProperty(compactResult, "record_entry");
  const recordEntryFoundValue = requiredDataProperty(compactResult, "record_entry_found");
  if (typeof recordEntryFoundValue !== "boolean") return null;
  const recordEntryFound = recordEntryFoundValue === true;
  if (recordEntryFound !== isObject(recordEntry)) return null;
  if (
    recordEntryFound &&
    (!selectedUnitIdentityMatches(requiredDataProperty(recordEntry, "unit"), requestedIdentity) ||
      !validateRecognizedIdentityTree([recordEntry], requestedIdentity))
  ) {
    return null;
  }
  const projectedEntry = recordEntryFound
    ? projectPublicGraphEntry(recordEntry, compactResult)
    : null;
  if (recordEntryFound && projectedEntry === null) return null;
  const result = {
    format: "graph-evidence-sidecar",
    record_id: requiredDataProperty(compactResult, "record_id"),
    selected_record: true,
    record_entry: projectedEntry,
    record_entry_found: recordEntryFound
  };
  return validateCompletedProjectionIdentity(result, requestedIdentity) ? result : null;
}

export function projectSelectedReadResult(compactResult, selector) {
  const requestedIdentity = requestedReadIdentity(selector);
  return selector.selected_slice
    ? projectSelectedSliceReadResult(compactResult, requestedIdentity)
    : projectSelectedRecordReadResult(compactResult, requestedIdentity);
}
