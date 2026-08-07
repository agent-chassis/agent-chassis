

import { canonicalizeWorkRecordReadScope } from "./work-record-schema.mjs";
import {
  SHA256_PATTERN,
  WORK_RECORD_COMPLETION_POLICY_VALUES,
  WORK_RECORD_STATUS_VALUES,
  WORK_UNIT_FACET_PROVENANCE_VALUES,
  WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES,
  WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES
} from "./work-record-schema-constants.mjs";
import {
  WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES,
  WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES
} from "./work-record-target-metrics.mjs";
import {
  ORDINAL_SLICE_ID_PATTERN,
  RECORD_ID_PATTERN,
  cloneJson,
  collectJsonDiffPaths,
  createDiagnostic,
  diagnosticPathIsWithin,
  finalizeEdit,
  findSliceIndexes,
  hasOwn,
  isObject,
  isString,
  jsonEqual,
  nextOrdinalSliceId,
  refusal
} from "./work-record-contract-edit-shared.mjs";

const READY_SLICE_DIFF_PATH_LIMIT = 64;

const READY_SLICE_CONTROL_FIELDS = Object.freeze([
  "unit", "slice_id", "expected_source_digest", "shaping_mode", "attestation_action", "verbose",
  "completion_policy"
]);
const READY_SLICE_PAYLOAD_FIELDS = Object.freeze([
  "title", "status", "work_kind", "priority", "owner", "depends_on", "read_scope",
  "repo_paths", "write_scope", "dispatch_intent", "acceptance", "expected_edit_targets",
  "expected_changed_line_budget", "agent_notes", "review_purpose"
]);
export const WORK_RECORD_READY_SLICE_FIELDS = Object.freeze([
  ...READY_SLICE_CONTROL_FIELDS,
  ...READY_SLICE_PAYLOAD_FIELDS
]);
const READY_SLICE_FIELD_SET = new Set(WORK_RECORD_READY_SLICE_FIELDS);
const READY_SHAPES = Object.freeze({
  implementation: { work_kind: "implementation", role: "worker" },
  reviewer: { work_kind: "review", role: "reviewer" },
  redteam: { work_kind: "redteam", role: "redteam" }
});
const READY_PRIORITIES = new Set(["low", "medium", "high", "critical"]);
const READY_ATTESTATION_ACTIONS = new Set(["preserve_or_refuse", "invalidate_for_review"]);

const READY_COMPLETION_POLICIES = new Set(WORK_RECORD_COMPLETION_POLICY_VALUES);
const READY_PROVENANCE = new Set(WORK_UNIT_FACET_PROVENANCE_VALUES);
const READY_TARGET_PROVENANCE_FIELDS = new Set([
  "path", "name", "kind", "operation", "activity_kind", "artifact_kind", "granularity", "optional"
]);
const READY_ACCEPTANCE_PROVENANCE_FIELDS = new Set([
  "text", "verification_method", "evidence_target"
]);

class ReadySliceInputError extends Error {
  constructor(code, message, path) {
    super(message);
    this.diagnostic = createDiagnostic(code, message, { path });
  }
}
function readyInputError(code, message, path) {
  throw new ReadySliceInputError(code, message, path);
}
function controlled(value, values, path, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!isString(value) || !values.has(value.trim())) {
    readyInputError("ready_slice_invalid_field", `${path} has an unsupported value`, path);
  }
  return value.trim();
}
function nonemptyString(value, path) {
  if (!isString(value) || !value.trim()) {
    readyInputError("ready_slice_invalid_field", `${path} must be a non-empty string`, path);
  }
  return value.trim();
}
function repoPath(value, path) {
  let normalized = nonemptyString(value, path);
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  const segments = normalized.split("/");
  if (
    !normalized || normalized.startsWith("/") || normalized.startsWith("~") ||
    /^[A-Za-z]:/u.test(normalized) || normalized.includes("\\") || normalized.includes("\0") ||
    segments.some((entry) => !entry || entry === "." || entry === "..")
  ) {
    readyInputError("ready_slice_invalid_path", `${path} must be a canonical repository-relative POSIX path`, path);
  }
  return normalized;
}
function stringList(value, path, { paths = false } = {}) {
  if (!Array.isArray(value)) {
    readyInputError("ready_slice_invalid_field", `${path} must be an array`, path);
  }
  return value.map((entry, index) => paths
    ? repoPath(entry, `${path}[${index}]`)
    : nonemptyString(entry, `${path}[${index}]`));
}
function strictProvenance(value, allowedFields, path) {
  if (!isObject(value)) {
    readyInputError("ready_slice_invalid_field", `${path} must be an object`, path);
  }
  const result = {};
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      readyInputError("ready_slice_unknown_field", `${path}.${key} is not allowed`, `${path}.${key}`);
    }
    result[key] = value[key] === null
      ? null
      : controlled(value[key], READY_PROVENANCE, `${path}.${key}`);
  }
  return result;
}
function normalizeAcceptance(value) {
  if (!isObject(value) || !Array.isArray(value.criteria) || !Array.isArray(value.validation)) {
    readyInputError("ready_slice_invalid_acceptance", "acceptance must contain complete criteria and validation arrays", "acceptance");
  }
  for (const key of Object.keys(value)) {
    if (!["criteria", "validation"].includes(key)) {
      readyInputError("ready_slice_unknown_field", `acceptance.${key} is not allowed`, `acceptance.${key}`);
    }
  }
  const criteria = value.criteria.map((entry, index) => {
    const path = `acceptance.criteria[${index}]`;
    if (isString(entry)) return nonemptyString(entry, path);
    if (!isObject(entry)) readyInputError("ready_slice_invalid_acceptance", `${path} must be a string or object`, path);
    const allowed = new Set(["text", "verification_method", "evidence_target", "facet_provenance"]);
    for (const key of Object.keys(entry)) {
      if (!allowed.has(key)) readyInputError("ready_slice_unknown_field", `${path}.${key} is not allowed`, `${path}.${key}`);
    }
    const result = { text: nonemptyString(entry.text, `${path}.text`) };
    if (hasOwn(entry, "verification_method")) {
      result.verification_method = controlled(
        entry.verification_method,
        new Set(WORK_UNIT_FEATURE_VECTOR_VERIFICATION_METHOD_VALUES),
        `${path}.verification_method`,
        { nullable: true }
      );
    }
    if (hasOwn(entry, "evidence_target")) {
      if (entry.evidence_target !== null && !isString(entry.evidence_target)) {
        readyInputError("ready_slice_invalid_acceptance", `${path}.evidence_target must be a string or null`, `${path}.evidence_target`);
      }
      result.evidence_target = entry.evidence_target;
    }
    if (hasOwn(entry, "facet_provenance")) {
      result.facet_provenance = strictProvenance(
        entry.facet_provenance,
        READY_ACCEPTANCE_PROVENANCE_FIELDS,
        `${path}.facet_provenance`
      );
    }
    return result;
  });
  return { criteria, validation: stringList(value.validation, "acceptance.validation") };
}
function normalizeTargets(value) {
  if (!Array.isArray(value)) readyInputError("ready_slice_invalid_targets", "expected_edit_targets must be an array", "expected_edit_targets");
  return value.map((entry, index) => {
    const path = `expected_edit_targets[${index}]`;
    if (!isObject(entry)) readyInputError("ready_slice_invalid_targets", `${path} must be an object`, path);
    const allowed = new Set(["path", "name", "kind", "operation", "activity_kind", "artifact_kind", "granularity", "optional", "facet_provenance"]);
    for (const key of Object.keys(entry)) {
      if (!allowed.has(key)) readyInputError("ready_slice_unknown_field", `${path}.${key} is not allowed`, `${path}.${key}`);
    }
    const result = {
      path: repoPath(entry.path, `${path}.path`),
      name: nonemptyString(entry.name, `${path}.name`),
      kind: controlled(entry.kind, new Set(WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES), `${path}.kind`),
      operation: controlled(entry.operation, new Set(WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES), `${path}.operation`)
    };
    const optionalEnums = [
      ["activity_kind", WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES],
      ["artifact_kind", WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES],
      ["granularity", WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES]
    ];
    for (const [field, values] of optionalEnums) {
      if (hasOwn(entry, field)) result[field] = controlled(entry[field], new Set(values), `${path}.${field}`, { nullable: true });
    }
    if (hasOwn(entry, "optional")) {
      if (typeof entry.optional !== "boolean") readyInputError("ready_slice_invalid_targets", `${path}.optional must be boolean`, `${path}.optional`);
      result.optional = entry.optional;
    }
    if (hasOwn(entry, "facet_provenance")) {
      result.facet_provenance = strictProvenance(entry.facet_provenance, READY_TARGET_PROVENANCE_FIELDS, `${path}.facet_provenance`);
    }
    return result;
  });
}
function normalizeReadyDispatchIntent(value) {
  if (!isObject(value)) readyInputError("ready_slice_invalid_dispatch_intent", "dispatch_intent must be an object", "dispatch_intent");
  const fields = ["intended_agent_role", "target_unit", "requires_graph_impact", "requires_escalation"];
  if (Object.keys(value).length !== fields.length || fields.some((field) => !hasOwn(value, field))) {
    readyInputError("ready_slice_invalid_dispatch_intent", "dispatch_intent must be a strict complete object", "dispatch_intent");
  }
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) readyInputError("ready_slice_unknown_field", `dispatch_intent.${key} is not allowed`, `dispatch_intent.${key}`);
  }
  if (typeof value.requires_graph_impact !== "boolean" || typeof value.requires_escalation !== "boolean") {
    readyInputError("ready_slice_invalid_dispatch_intent", "dispatch_intent control flags must be boolean", "dispatch_intent");
  }
  return {
    intended_agent_role: controlled(
      value.intended_agent_role,
      new Set(["worker", "reviewer", "redteam"]),
      "dispatch_intent.intended_agent_role"
    ),
    target_unit: controlled(value.target_unit, new Set(["slice"]), "dispatch_intent.target_unit"),
    requires_graph_impact: value.requires_graph_impact,
    requires_escalation: value.requires_escalation
  };
}
function normalizeAgentNotes(value) {
  if (Array.isArray(value)) {
    if (!value.every(isString)) readyInputError("ready_slice_invalid_agent_notes", "agent_notes entries must be strings", "agent_notes");
    value = value.join("\n");
  }
  if (!isString(value) || Buffer.byteLength(value, "utf8") > 8192) {
    readyInputError("ready_slice_invalid_agent_notes", "agent_notes must be a string bounded to 8192 UTF-8 bytes", "agent_notes");
  }
  return value;
}

export function validateWorkRecordReadySliceRequest(request) {
  try {
    if (!isObject(request)) readyInputError("ready_slice_invalid_request", "ready-slice input must be an object", null);
    for (const key of Object.keys(request)) {
      if (!READY_SLICE_FIELD_SET.has(key)) readyInputError("ready_slice_unknown_field", `ready-slice field '${key}' is not allowed`, key);
    }
    if (!isString(request.unit) || !RECORD_ID_PATTERN.test(request.unit)) readyInputError("invalid_unit_address", "unit must be a canonical parent WK-#### address", "unit");
    if (hasOwn(request, "slice_id") && (!isString(request.slice_id) || !ORDINAL_SLICE_ID_PATTERN.test(request.slice_id))) readyInputError("invalid_slice_id", "slice_id must be SLICE-###", "slice_id");
    if (hasOwn(request, "expected_source_digest") && (!isString(request.expected_source_digest) || !SHA256_PATTERN.test(request.expected_source_digest))) readyInputError("invalid_expected_source_digest", "expected_source_digest must be sha256:<64 lowercase hex>", "expected_source_digest");
    if (hasOwn(request, "shaping_mode")) controlled(request.shaping_mode, new Set(Object.keys(READY_SHAPES)), "shaping_mode");
    if (hasOwn(request, "attestation_action")) controlled(request.attestation_action, READY_ATTESTATION_ACTIONS, "attestation_action");
    if (hasOwn(request, "verbose") && typeof request.verbose !== "boolean") readyInputError("ready_slice_invalid_field", "verbose must be boolean", "verbose");
    if (hasOwn(request, "title")) nonemptyString(request.title, "title");
    if (hasOwn(request, "status")) controlled(request.status, new Set(WORK_RECORD_STATUS_VALUES), "status");
    if (hasOwn(request, "priority")) controlled(request.priority, READY_PRIORITIES, "priority");
    if (hasOwn(request, "owner")) nonemptyString(request.owner, "owner");
    if (hasOwn(request, "depends_on")) stringList(request.depends_on, "depends_on");
    if (hasOwn(request, "read_scope")) stringList(request.read_scope, "read_scope");
    if (hasOwn(request, "repo_paths")) stringList(request.repo_paths, "repo_paths", { paths: true });
    if (hasOwn(request, "write_scope")) stringList(request.write_scope, "write_scope", { paths: true });
    if (hasOwn(request, "acceptance")) normalizeAcceptance(request.acceptance);
    if (hasOwn(request, "expected_edit_targets")) normalizeTargets(request.expected_edit_targets);
    if (hasOwn(request, "dispatch_intent")) normalizeReadyDispatchIntent(request.dispatch_intent);
    if (hasOwn(request, "agent_notes")) normalizeAgentNotes(request.agent_notes);
    if (
      hasOwn(request, "expected_changed_line_budget") &&
      request.expected_changed_line_budget !== null &&
      (!Number.isInteger(request.expected_changed_line_budget) || request.expected_changed_line_budget < 0)
    ) readyInputError("ready_slice_invalid_field", "expected_changed_line_budget must be a non-negative integer or null", "expected_changed_line_budget");
    if (hasOwn(request, "work_kind")) controlled(request.work_kind, new Set(["implementation", "review", "redteam"]), "work_kind");
    if (hasOwn(request, "review_purpose")) controlled(request.review_purpose, new Set(["standalone", "terminal_whole_wk"]), "review_purpose");
    if (hasOwn(request, "completion_policy")) controlled(request.completion_policy, READY_COMPLETION_POLICIES, "completion_policy");
    return { ok: true, diagnostics: [] };
  } catch (error) {
    if (!(error instanceof ReadySliceInputError)) throw error;
    return { ok: false, diagnostics: [error.diagnostic] };
  }
}

function effectiveShapeForUpdate(slice) {
  for (const [mode, shape] of Object.entries(READY_SHAPES)) {
    if (
      slice?.work_kind === shape.work_kind &&
      slice?.dispatch_intent?.intended_agent_role === shape.role &&
      slice?.dispatch_intent?.target_unit === "slice" &&
      typeof slice?.dispatch_intent?.requires_graph_impact === "boolean" &&
      typeof slice?.dispatch_intent?.requires_escalation === "boolean"
    ) return mode;
  }
  return null;
}

export function planWorkRecordReadySlice(record, request = {}) {
  const requestCheck = validateWorkRecordReadySliceRequest(request);
  if (!requestCheck.ok) return refusal(requestCheck.diagnostics[0]);
  try {
    if (!isObject(record) || record.id !== request.unit) readyInputError("ready_slice_record_mismatch", "unit does not match the loaded work record", "unit");
    const create = !hasOwn(request, "slice_id");
    const slices = Array.isArray(record.slices) ? record.slices : [];
    let sliceId = request.slice_id;
    let sliceIndex = -1;
    if (create) {
      sliceId = nextOrdinalSliceId(record);
      if (!sliceId) readyInputError("ordinal_slice_id_exhausted", "no unused ordinal slice ids remain", "slice_id");
    } else {
      const indexes = findSliceIndexes(record, sliceId);
      if (indexes.length !== 1) readyInputError(indexes.length ? "ready_slice_ambiguous_slice" : "slice_not_found", `slice '${sliceId}' must identify exactly one existing slice`, "slice_id");
      sliceIndex = indexes[0];
    }
    const existing = create ? null : slices[sliceIndex];
    const requestedMode = hasOwn(request, "shaping_mode") ? request.shaping_mode.trim() : null;
    const mode = requestedMode ?? (create ? "implementation" : effectiveShapeForUpdate(existing));
    if (!mode) readyInputError("ready_slice_unsupported_effective_shape", "existing slice requires explicit implementation, reviewer, or redteam shaping", "shaping_mode");
    const shape = READY_SHAPES[mode];
    const action = hasOwn(request, "attestation_action") ? request.attestation_action.trim() : "preserve_or_refuse";
    if (create && action === "invalidate_for_review") readyInputError("ready_slice_invalid_attestation_action", "creation cannot invalidate an attestation", "attestation_action");

    const supplied = {};
    if (hasOwn(request, "title")) supplied.title = nonemptyString(request.title, "title");
    if (hasOwn(request, "status")) supplied.status = controlled(request.status, new Set(WORK_RECORD_STATUS_VALUES), "status");
    if (hasOwn(request, "priority")) supplied.priority = controlled(request.priority, READY_PRIORITIES, "priority");
    if (hasOwn(request, "owner")) supplied.owner = nonemptyString(request.owner, "owner");
    if (hasOwn(request, "depends_on")) supplied.depends_on = stringList(request.depends_on, "depends_on");
    if (hasOwn(request, "read_scope")) supplied.read_scope = stringList(request.read_scope, "read_scope");
    if (hasOwn(request, "repo_paths")) supplied.repo_paths = stringList(request.repo_paths, "repo_paths", { paths: true });
    if (hasOwn(request, "write_scope")) supplied.write_scope = stringList(request.write_scope, "write_scope", { paths: true });
    if (hasOwn(request, "acceptance")) supplied.acceptance = normalizeAcceptance(request.acceptance);
    if (hasOwn(request, "expected_edit_targets")) supplied.expected_edit_targets = normalizeTargets(request.expected_edit_targets);
    if (hasOwn(request, "expected_changed_line_budget")) {
      if (request.expected_changed_line_budget !== null && (!Number.isInteger(request.expected_changed_line_budget) || request.expected_changed_line_budget < 0)) readyInputError("ready_slice_invalid_field", "expected_changed_line_budget must be a non-negative integer or null", "expected_changed_line_budget");
      supplied.expected_changed_line_budget = request.expected_changed_line_budget;
    }
    if (hasOwn(request, "agent_notes")) supplied.agent_notes = normalizeAgentNotes(request.agent_notes);
    if (hasOwn(request, "review_purpose")) supplied.review_purpose = controlled(request.review_purpose, new Set(["standalone", "terminal_whole_wk"]), "review_purpose");
    const completionPolicy = hasOwn(request, "completion_policy")
      ? controlled(request.completion_policy, READY_COMPLETION_POLICIES, "completion_policy")
      : null;
    if (hasOwn(request, "work_kind") && request.work_kind.trim() !== shape.work_kind) readyInputError("ready_slice_shaping_conflict", "work_kind contradicts shaping_mode", "work_kind");
    const incomingIntent = hasOwn(request, "dispatch_intent") ? normalizeReadyDispatchIntent(request.dispatch_intent) : null;
    if (incomingIntent && (incomingIntent.intended_agent_role !== shape.role || incomingIntent.target_unit !== "slice")) readyInputError("ready_slice_shaping_conflict", "dispatch_intent contradicts shaping_mode", "dispatch_intent");

    if (create) {
      for (const field of ["title", "read_scope", "repo_paths", "acceptance"]) {
        if (!hasOwn(supplied, field)) readyInputError("ready_slice_missing_required_field", `${field} is required on create`, field);
      }
    }
    const next = create ? {
      id: sliceId,
      title: supplied.title,
      work_kind: shape.work_kind,
      status: supplied.status ?? "todo",
      priority: supplied.priority ?? "medium",
      owner: supplied.owner ?? "unassigned",
      depends_on: supplied.depends_on ?? [],
      read_scope: supplied.read_scope,
      repo_paths: supplied.repo_paths,
      write_scope: supplied.write_scope ?? [],
      dispatch_intent: incomingIntent ?? {
        intended_agent_role: shape.role,
        target_unit: "slice",
        requires_graph_impact: false,
        requires_escalation: false
      },
      acceptance: supplied.acceptance,
      expected_edit_targets: supplied.expected_edit_targets ?? [],
      expected_changed_line_budget: supplied.expected_changed_line_budget ?? null
    } : { ...cloneJson(existing), ...cloneJson(supplied) };
    delete next.agent_notes;
    next.work_kind = shape.work_kind;
    if (mode === "reviewer") {
      next.review_purpose = supplied.review_purpose ?? next.review_purpose ?? "standalone";
    } else {
      if (hasOwn(request, "review_purpose")) readyInputError("ready_slice_review_purpose_incompatible", "review_purpose is valid only for reviewer shaping", "review_purpose");
      delete next.review_purpose;
    }

    if (completionPolicy && next.review_purpose !== "terminal_whole_wk") {
      readyInputError(
        "ready_slice_completion_policy_incompatible",
        "completion_policy is valid only for terminal_whole_wk review shaping",
        "completion_policy"
      );
    }
    const preservedIntent = incomingIntent ?? cloneJson(existing?.dispatch_intent) ?? {};
    next.dispatch_intent = {
      intended_agent_role: shape.role,
      target_unit: "slice",
      requires_graph_impact: preservedIntent.requires_graph_impact ?? false,
      requires_escalation: preservedIntent.requires_escalation ?? false
    };
    if (hasOwn(supplied, "agent_notes")) {
      next.sections = isObject(next.sections) ? cloneJson(next.sections) : {};
      next.sections.agent_notes = supplied.agent_notes;
    }
    if (mode !== "implementation") {
      if (hasOwn(request, "write_scope") && supplied.write_scope.length > 0) readyInputError("ready_slice_findings_write_scope_nonempty", "reviewer/redteam write_scope must be empty", "write_scope");
      next.write_scope = [];
      if (
        Array.isArray(next.expected_edit_targets) &&
        next.expected_edit_targets.some((target) => target?.operation !== "inspect")
      ) readyInputError("ready_slice_findings_targets_not_read_only", "reviewer/redteam expected_edit_targets must be an inspection plan", "expected_edit_targets");
    }
    if (!Array.isArray(next.read_scope) || next.read_scope.length === 0) readyInputError("ready_slice_incomplete_contract", "read_scope must be non-empty", "read_scope");
    if (!Array.isArray(next.repo_paths) || next.repo_paths.length === 0) readyInputError("ready_slice_incomplete_contract", "repo_paths must be non-empty", "repo_paths");
    if (!isObject(next.acceptance) || next.acceptance.criteria?.length === 0 || next.acceptance.validation?.length === 0) readyInputError("ready_slice_incomplete_contract", "acceptance criteria and validation must be non-empty", "acceptance");
    if (mode === "implementation" && (!Array.isArray(next.write_scope) || next.write_scope.length === 0)) readyInputError("ready_slice_implementation_write_scope_empty", "implementation write_scope must be non-empty", "write_scope");
    if (mode === "implementation" && (!Array.isArray(next.expected_edit_targets) || next.expected_edit_targets.length === 0)) readyInputError("ready_slice_implementation_targets_empty", "implementation expected_edit_targets must be non-empty", "expected_edit_targets");

    const clone = cloneJson(record);
    const policyChanged = Boolean(completionPolicy) && clone.completion_policy !== completionPolicy;
    if (policyChanged) clone.completion_policy = completionPolicy;
    if (create) {
      sliceIndex = clone.slices.length;
      clone.slices.push(next);
    } else clone.slices[sliceIndex] = next;
    const changedSliceFields = create
      ? ["slice"]
      : Object.keys({ ...existing, ...next }).filter((field) => !jsonEqual(existing[field], next[field]));
    const changedFields = changedSliceFields.map((field) => field === "slice" ? `slices[${sliceId}]` : `slices[${sliceId}].${field}`);
    if (policyChanged) changedFields.push("completion_policy");
    const canonical = canonicalizeWorkRecordReadScope(clone);
    const diffPaths = collectJsonDiffPaths(record, canonical);
    const allowedPrefixes = create
      ? [`slices[${sliceIndex}]`]
      : changedSliceFields.map((field) => `slices[${sliceIndex}].${field}`);
    if (policyChanged) allowedPrefixes.push("completion_policy");
    const disallowed = diffPaths.find((path) => !allowedPrefixes.some((prefix) => diagnosticPathIsWithin(path, prefix)));
    if (disallowed) readyInputError("ready_slice_persisted_diff_guard_failed", `ready-slice would persist an unrelated change at ${disallowed}`, disallowed);
    const finalized = finalizeEdit(canonical, changedFields);
    if (!finalized.ok) return finalized;
    const boundedPaths = diffPaths.slice(0, READY_SLICE_DIFF_PATH_LIMIT);
    if (diffPaths.length > boundedPaths.length) {
      finalized.diagnostics.push(createDiagnostic(
        "ready_slice_diff_truncated",
        `ready-slice normalized diff is bounded to ${READY_SLICE_DIFF_PATH_LIMIT} paths`,
        { severity: "warning", path: null }
      ));
    }
    return {
      ...finalized,
      selectedUnit: { kind: "slice", address: `${record.id}#${sliceId}`, record_id: record.id, slice_id: sliceId },
      changedPaths: boundedPaths,
      allowedPersistedPrefixes: allowedPrefixes,
      shapingMode: mode,
      attestationAction: action,
      create
    };
  } catch (error) {
    if (!(error instanceof ReadySliceInputError)) throw error;
    return refusal(error.diagnostic);
  }
}

export function guardWorkRecordReadySlicePersistedDiff(
  baseRecord,
  candidateRecord,
  { allowedPrefixes = [], allowEvidenceInvalidation = false } = {}
) {
  const normalizedCandidate = canonicalizeWorkRecordReadScope(cloneJson(candidateRecord));
  const diffPaths = collectJsonDiffPaths(baseRecord, normalizedCandidate);
  const allowed = [...allowedPrefixes, "updated"];
  if (allowEvidenceInvalidation) allowed.push("derived_evidence");
  const disallowed = diffPaths.find((entry) => !allowed.some((prefix) => diagnosticPathIsWithin(entry, prefix)));
  if (disallowed) {
    return {
      ok: false,
      normalizedCandidate: null,
      diffPaths,
      diagnostic: createDiagnostic(
        "ready_slice_persisted_diff_guard_failed",
        `ready-slice would persist an unauthorized change at ${disallowed}`,
        { path: disallowed }
      )
    };
  }
  return { ok: true, normalizedCandidate, diffPaths, diagnostic: null };
}
