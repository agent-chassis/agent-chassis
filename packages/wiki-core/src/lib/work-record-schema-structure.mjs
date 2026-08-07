

import {
  validateExpectedEditTargetKind,
  validateExpectedEditTargetOperation,
  WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES,
  WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES
} from "./work-record-target-metrics.mjs";
import {
  hasOwn,
  isObject,
  isString,
  isNullableString,
  addDiagnostic,
  validateStringField,
  validateStringArrayField,
  validateNullableStringField,
  validateNullableNonNegativeIntegerField,
  validateEnumField,
  validateControlledStringField,
  validateFacetProvenance,
  validateAcceptanceCriterionEntry
} from "./work-record-schema-validators.mjs";
import { validateWorkerAdmissionDerivedEvidenceStructure } from "./work-record-schema-derived-evidence.mjs";
import {
  WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES,
  WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES,
  WORK_RECORD_AGENT_ROLE_VALUES,
  WORK_RECORD_TARGET_UNIT_VALUES,
  WORK_RECORD_WORK_KIND_VALUES,
  WORK_RECORD_REVIEW_PURPOSE_VALUES,
  WORK_RECORD_COMPLETION_POLICY_VALUES,
  WORK_RECORD_STATUS_VALUES,
  WORK_RECORD_ESCALATION_KIND_VALUES,
  WORK_RECORD_ESCALATION_STATUS_VALUES,
  WORK_RECORD_ESCALATION_PROVENANCE_SOURCE_KIND_VALUES,
  WORK_RECORD_ESCALATION_PROVENANCE_CANONICALITY_VALUES,
  WORK_RECORD_ESCALATION_PROVENANCE_EVIDENCE_BASIS_VALUES,
  WORK_RECORD_RENDER_SCHEMA_VERSION,
  WORK_RECORD_PROJECTION_KIND_VALUES,
  WORK_RECORD_SCHEMA_VERSION,
  WORK_RECORD_PROJECTION_AUTHORITY,
  WORK_RECORD_DERIVED_EVIDENCE_SCHEMA_VERSION,
  WORK_RECORD_DERIVED_EVIDENCE_DECISION_KIND_VALUES,
  WORK_RECORD_MIGRATION_REVIEW_STATE_VALUES,
  REQUIRED_ARRAY_OF_STRING_TOP_LEVEL_FIELDS,
  OPTIONAL_ARRAY_OF_STRING_TOP_LEVEL_FIELDS,
  OPTIONAL_NON_NEGATIVE_INTEGER_TOP_LEVEL_FIELDS,
  SLICE_ID_PATTERN,
  ESCALATION_ID_PATTERN,
  SHA256_PATTERN
} from "./work-record-schema-constants.mjs";

function validateExpectedEditTargetFacetFields(diagnostics, entry, path) {
  validateControlledStringField(
    diagnostics,
    entry,
    "activity_kind",
    WORK_UNIT_FEATURE_VECTOR_ACTIVITY_KIND_VALUES,
    { path: `${path}.activity_kind`, allowNull: true }
  );
  validateControlledStringField(
    diagnostics,
    entry,
    "artifact_kind",
    WORK_UNIT_FEATURE_VECTOR_ARTIFACT_KIND_VALUES,
    { path: `${path}.artifact_kind`, allowNull: true }
  );
  validateControlledStringField(
    diagnostics,
    entry,
    "granularity",
    WORK_UNIT_FEATURE_VECTOR_GRANULARITY_VALUES,
    { path: `${path}.granularity`, allowNull: true }
  );
  if (hasOwn(entry, "facet_provenance")) {
    validateFacetProvenance(diagnostics, entry.facet_provenance, `${path}.facet_provenance`);
  }
}

function validateTasks(diagnostics, tasks, path) {
  if (!Array.isArray(tasks)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an array`, { path });
    return;
  }

  tasks.forEach((task, index) => {
    const taskPath = `${path}[${index}]`;
    if (!isObject(task)) {
      addDiagnostic(diagnostics, "invalid_record", `${taskPath} must be an object`, {
        path: taskPath
      });
      return;
    }
    validateStringField(diagnostics, task, "text", { path: `${taskPath}.text` });
    validateEnumField(diagnostics, task, "status", ["todo", "done"], {
      path: `${taskPath}.status`
    });
  });
}

function validateClosure(diagnostics, closure, path) {
  if (closure === null) {
    return;
  }
  if (!isObject(closure)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be null or an object`, { path });
    return;
  }
  validateStringField(diagnostics, closure, "summary", { path: `${path}.summary`, allowEmpty: true });
  validateStringArrayField(diagnostics, closure, "validation", { path: `${path}.validation` });
  validateStringArrayField(diagnostics, closure, "follow_ups", { path: `${path}.follow_ups` });
}

function validateScope(diagnostics, scope, path) {
  if (!isObject(scope)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }
  validateStringArrayField(diagnostics, scope, "items", { path: `${path}.items` });
  validateStringArrayField(diagnostics, scope, "out_of_scope", { path: `${path}.out_of_scope` });
}

function validateDispatchIntent(diagnostics, dispatchIntent, path = "dispatch_intent") {
  if (!isObject(dispatchIntent)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  if (!hasOwn(dispatchIntent, "intended_agent_role")) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.intended_agent_role is required`, {
      path: `${path}.intended_agent_role`
    });
  } else if (
    dispatchIntent.intended_agent_role !== null &&
    !WORK_RECORD_AGENT_ROLE_VALUES.includes(dispatchIntent.intended_agent_role)
  ) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.intended_agent_role must be one of: worker, reviewer, redteam, decision_worker, orchestrator, null`,
      { path: `${path}.intended_agent_role` }
    );
  }

  validateStringField(diagnostics, dispatchIntent, "target_unit", {
    path: `${path}.target_unit`
  });
  if (hasOwn(dispatchIntent, "target_unit") && !WORK_RECORD_TARGET_UNIT_VALUES.includes(dispatchIntent.target_unit)) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.target_unit must be one of: none, record, slice`,
      { path: `${path}.target_unit` }
    );
  }

  if (!hasOwn(dispatchIntent, "requires_graph_impact") || typeof dispatchIntent.requires_graph_impact !== "boolean") {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.requires_graph_impact must be a boolean`,
      { path: `${path}.requires_graph_impact` }
    );
  }
  if (!hasOwn(dispatchIntent, "requires_escalation") || typeof dispatchIntent.requires_escalation !== "boolean") {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.requires_escalation must be a boolean`,
      { path: `${path}.requires_escalation` }
    );
  }
}

function validateExpectedEditTargets(diagnostics, value, path) {
  if (value === null || value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an array of target entries`, {
      path
    });
    return;
  }
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isObject(entry)) {
      addDiagnostic(diagnostics, "invalid_record", `${entryPath} must be an object`, {
        path: entryPath
      });
      return;
    }
    validateStringField(diagnostics, entry, "path", {
      path: `${entryPath}.path`,
      allowEmpty: false
    });
    validateStringField(diagnostics, entry, "name", {
      path: `${entryPath}.name`,
      allowEmpty: false
    });
    if (
      hasOwn(entry, "kind") &&
      isString(entry.kind) &&
      validateExpectedEditTargetKind(entry.kind).status !== "valid"
    ) {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        `${entryPath}.kind must be one of: ${WORK_RECORD_EXPECTED_EDIT_TARGET_KIND_VALUES.join(", ")}`,
        { path: `${entryPath}.kind` }
      );
    } else {
      validateStringField(diagnostics, entry, "kind", {
        path: `${entryPath}.kind`,
        allowEmpty: false
      });
    }
    if (
      hasOwn(entry, "operation") &&
      isString(entry.operation) &&
      validateExpectedEditTargetOperation(entry.operation).status !== "valid"
    ) {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        `${entryPath}.operation must be one of: ${WORK_RECORD_EXPECTED_EDIT_TARGET_OPERATION_VALUES.join(", ")}`,
        { path: `${entryPath}.operation` }
      );
    } else {
      validateStringField(diagnostics, entry, "operation", {
        path: `${entryPath}.operation`,
        allowEmpty: false
      });
    }
    validateExpectedEditTargetFacetFields(diagnostics, entry, entryPath);
    if (hasOwn(entry, "optional") && typeof entry.optional !== "boolean") {
      addDiagnostic(diagnostics, "invalid_record", `${entryPath}.optional must be a boolean`, {
        path: `${entryPath}.optional`
      });
    }
  });
}

function validateAcceptance(diagnostics, acceptance, path = "acceptance") {
  if (!isObject(acceptance)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  if (!hasOwn(acceptance, "criteria") || !Array.isArray(acceptance.criteria)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.criteria must be an array`, {
      path: `${path}.criteria`
    });
  } else {
    acceptance.criteria.forEach((entry, index) =>
      validateAcceptanceCriterionEntry(diagnostics, entry, `${path}.criteria[${index}]`, {
        allowString: true
      })
    );
  }
  validateStringArrayField(diagnostics, acceptance, "validation", { path: `${path}.validation` });
}

function validateChildReference(diagnostics, child, path) {
  if (!isObject(child)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  validateStringField(diagnostics, child, "repo", { path: `${path}.repo` });
  validateStringField(diagnostics, child, "id", { path: `${path}.id` });
  validateStringField(diagnostics, child, "relation", { path: `${path}.relation` });
  if (
    isString(child.relation) &&
    !["implements_slice", "design_follow_up", "review_follow_up", "migration_step", "blocks_tracker_closure"].includes(child.relation)
  ) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.relation must be one of: implements_slice, design_follow_up, review_follow_up, migration_step, blocks_tracker_closure`,
      { path: `${path}.relation` }
    );
  }
  validateStringField(diagnostics, child, "title", { path: `${path}.title` });
  validateEnumField(diagnostics, child, "work_kind", WORK_RECORD_WORK_KIND_VALUES, {
    path: `${path}.work_kind`
  });
  validateEnumField(diagnostics, child, "status", WORK_RECORD_STATUS_VALUES, {
    path: `${path}.status`
  });
  if (!hasOwn(child, "cluster_expectation") || !isObject(child.cluster_expectation)) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.cluster_expectation must be an object`,
      { path: `${path}.cluster_expectation` }
    );
  } else {
    const clusterExpectation = child.cluster_expectation;
    if (
      !hasOwn(clusterExpectation, "expected_cluster_count") ||
      !Number.isInteger(clusterExpectation.expected_cluster_count)
    ) {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        `${path}.cluster_expectation.expected_cluster_count must be an integer`,
        { path: `${path}.cluster_expectation.expected_cluster_count` }
      );
    }
    validateStringField(diagnostics, clusterExpectation, "reason", {
      path: `${path}.cluster_expectation.reason`
    });
  }
  if (!hasOwn(child, "sequencing") || !isObject(child.sequencing)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.sequencing must be an object`, {
      path: `${path}.sequencing`
    });
  } else {
    validateStringArrayField(diagnostics, child.sequencing, "after", {
      path: `${path}.sequencing.after`
    });
    validateStringArrayField(diagnostics, child.sequencing, "before", {
      path: `${path}.sequencing.before`
    });
    if (
      hasOwn(child.sequencing, "parallel_group") &&
      !isNullableString(child.sequencing.parallel_group)
    ) {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        `${path}.sequencing.parallel_group must be a string or null`,
        { path: `${path}.sequencing.parallel_group` }
      );
    }
  }
  validateStringField(diagnostics, child, "dispatch_unit_ref", {
    path: `${path}.dispatch_unit_ref`
  });
}

function validateSliceReadScope(diagnostics, slice, path) {
  const hasRead = hasOwn(slice, "read_scope");
  const hasDocs = hasOwn(slice, "docs");
  if (!hasRead && !hasDocs) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.read_scope is required`, {
      path: `${path}.read_scope`
    });
    return;
  }
  if (hasRead) {
    validateStringArrayField(diagnostics, slice, "read_scope", {
      path: `${path}.read_scope`,
      required: false
    });
  }
  if (hasDocs) {
    validateStringArrayField(diagnostics, slice, "docs", {
      path: `${path}.docs`,
      required: false
    });
  }
}

function validateSlice(diagnostics, slice, path) {
  if (!isObject(slice)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  validateStringField(diagnostics, slice, "id", { path: `${path}.id` });
  if (isString(slice.id) && !SLICE_ID_PATTERN.test(slice.id)) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.id must match ${SLICE_ID_PATTERN}`,
      { path: `${path}.id` }
    );
  }
  validateStringField(diagnostics, slice, "title", { path: `${path}.title` });
  validateEnumField(diagnostics, slice, "work_kind", WORK_RECORD_WORK_KIND_VALUES, {
    path: `${path}.work_kind`
  });
  if (hasOwn(slice, "review_purpose")) {
    validateEnumField(diagnostics, slice, "review_purpose", WORK_RECORD_REVIEW_PURPOSE_VALUES, {
      path: `${path}.review_purpose`, required: false
    });
    if (slice.work_kind !== "review") {
      addDiagnostic(diagnostics, "invalid_record", `${path}.review_purpose is valid only for review work`, {
        path: `${path}.review_purpose`
      });
    }
  }
  if (slice.work_kind === "tracker") {
    addDiagnostic(diagnostics, "invalid_record", `${path}.work_kind cannot be tracker`, {
      path: `${path}.work_kind`
    });
  }
  validateEnumField(diagnostics, slice, "status", WORK_RECORD_STATUS_VALUES, {
    path: `${path}.status`
  });
  if (hasOwn(slice, "completion_policy")) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.completion_policy is only valid on a record`,
      { path: `${path}.completion_policy` }
    );
  }
  validateStringArrayField(diagnostics, slice, "write_scope", { path: `${path}.write_scope` });
  validateStringArrayField(diagnostics, slice, "repo_paths", { path: `${path}.repo_paths` });
  validateSliceReadScope(diagnostics, slice, path);
  validateStringArrayField(diagnostics, slice, "depends_on", { path: `${path}.depends_on` });
  validateAcceptance(diagnostics, slice.acceptance, `${path}.acceptance`);
  validateDispatchIntent(diagnostics, slice.dispatch_intent, `${path}.dispatch_intent`);
  validateNullableNonNegativeIntegerField(diagnostics, slice, "expected_changed_line_budget", {
    path: `${path}.expected_changed_line_budget`,
    required: false
  });
  if (hasOwn(slice, "expected_edit_targets")) {
    validateExpectedEditTargets(diagnostics, slice.expected_edit_targets, `${path}.expected_edit_targets`);
  }
  if (hasOwn(slice, "closure")) {
    validateClosure(diagnostics, slice.closure, `${path}.closure`);
  }
  if (isObject(slice.sections)) {
    const sections = slice.sections;
    if (hasOwn(sections, "agent_notes")) {
      const value = sections.agent_notes;
      if (Array.isArray(value)) {
        validateStringArrayField(diagnostics, sections, "agent_notes", {
          path: `${path}.sections.agent_notes`,
          required: false
        });
      } else {
        validateStringField(diagnostics, sections, "agent_notes", {
          path: `${path}.sections.agent_notes`,
          required: false,
          allowEmpty: true
        });
      }
    }
  }
  if (slice.dispatch_intent && slice.dispatch_intent.target_unit !== "slice") {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.dispatch_intent.target_unit must be slice`,
      { path: `${path}.dispatch_intent.target_unit` }
    );
  }
}

function validateEscalation(diagnostics, escalation, path) {
  if (!isObject(escalation)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  validateStringField(diagnostics, escalation, "id", { path: `${path}.id` });
  if (isString(escalation.id) && !ESCALATION_ID_PATTERN.test(escalation.id)) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.id must match ${ESCALATION_ID_PATTERN}`,
      { path: `${path}.id` }
    );
  }

  validateStringField(diagnostics, escalation, "kind", { path: `${path}.kind` });
  if (isString(escalation.kind) && !WORK_RECORD_ESCALATION_KIND_VALUES.includes(escalation.kind)) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.kind must be one of: ${WORK_RECORD_ESCALATION_KIND_VALUES.join(", ")}`,
      { path: `${path}.kind` }
    );
  }
  validateStringField(diagnostics, escalation, "status", { path: `${path}.status` });
  if (
    isString(escalation.status) &&
    !WORK_RECORD_ESCALATION_STATUS_VALUES.includes(escalation.status)
  ) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.status must be one of: ${WORK_RECORD_ESCALATION_STATUS_VALUES.join(", ")}`,
      { path: `${path}.status` }
    );
  }

  if (!hasOwn(escalation, "scope") || !isObject(escalation.scope)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.scope must be an object`, {
      path: `${path}.scope`
    });
  } else {
    validateStringField(diagnostics, escalation.scope, "unit", { path: `${path}.scope.unit` });
    if (hasOwn(escalation.scope, "slice_id") && !isNullableString(escalation.scope.slice_id)) {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        `${path}.scope.slice_id must be a string or null`,
        { path: `${path}.scope.slice_id` }
      );
    }
    validateStringArrayField(diagnostics, escalation.scope, "write_scope", {
      path: `${path}.scope.write_scope`
    });
    if (hasOwn(escalation.scope, "max_blast_radius") && !isString(escalation.scope.max_blast_radius)) {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        `${path}.scope.max_blast_radius must be a string`,
        { path: `${path}.scope.max_blast_radius` }
      );
    }
  }

  validateStringField(diagnostics, escalation, "reason", { path: `${path}.reason` });

  if (!hasOwn(escalation, "accepted_by") || !isObject(escalation.accepted_by)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.accepted_by must be an object`, {
      path: `${path}.accepted_by`
    });
  } else {
    validateStringField(diagnostics, escalation.accepted_by, "actor", {
      path: `${path}.accepted_by.actor`
    });
    if (
      isString(escalation.accepted_by.actor) &&
      !["operator", "orchestrator", "reviewer"].includes(escalation.accepted_by.actor)
    ) {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        `${path}.accepted_by.actor must be one of: operator, orchestrator, reviewer`,
        { path: `${path}.accepted_by.actor` }
      );
    }
    validateStringField(diagnostics, escalation.accepted_by, "id", {
      path: `${path}.accepted_by.id`
    });
    validateStringField(diagnostics, escalation.accepted_by, "source", {
      path: `${path}.accepted_by.source`
    });
    if (
      isString(escalation.accepted_by.source) &&
      !["explicit_user_instruction", "accepted_decision", "reviewed_handoff", "closed_work_record"].includes(escalation.accepted_by.source)
    ) {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        `${path}.accepted_by.source must be one of: explicit_user_instruction, accepted_decision, reviewed_handoff, closed_work_record`,
        { path: `${path}.accepted_by.source` }
      );
    }
  }

  validateStringField(diagnostics, escalation, "accepted_at", { path: `${path}.accepted_at` });
  if (hasOwn(escalation, "expires_at") && !isNullableString(escalation.expires_at)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.expires_at must be a string or null`, {
      path: `${path}.expires_at`
    });
  }
  validateStringField(diagnostics, escalation, "authority_ref", {
    path: `${path}.authority_ref`
  });

  if (!hasOwn(escalation, "provenance") || !isObject(escalation.provenance)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.provenance must be an object`, {
      path: `${path}.provenance`
    });
  } else {
    validateStringField(diagnostics, escalation.provenance, "source_kind", {
      path: `${path}.provenance.source_kind`
    });
    if (
      isString(escalation.provenance.source_kind) &&
      !WORK_RECORD_ESCALATION_PROVENANCE_SOURCE_KIND_VALUES.includes(escalation.provenance.source_kind)
    ) {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        `${path}.provenance.source_kind must be one of: ${WORK_RECORD_ESCALATION_PROVENANCE_SOURCE_KIND_VALUES.join(", ")}`,
        { path: `${path}.provenance.source_kind` }
      );
    }
    validateStringField(diagnostics, escalation.provenance, "canonicality", {
      path: `${path}.provenance.canonicality`
    });
    if (
      isString(escalation.provenance.canonicality) &&
      !WORK_RECORD_ESCALATION_PROVENANCE_CANONICALITY_VALUES.includes(
        escalation.provenance.canonicality
      )
    ) {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        `${path}.provenance.canonicality must be one of: ${WORK_RECORD_ESCALATION_PROVENANCE_CANONICALITY_VALUES.join(", ")}`,
        { path: `${path}.provenance.canonicality` }
      );
    }
    validateStringField(diagnostics, escalation.provenance, "evidence_basis", {
      path: `${path}.provenance.evidence_basis`
    });
    if (
      isString(escalation.provenance.evidence_basis) &&
      !WORK_RECORD_ESCALATION_PROVENANCE_EVIDENCE_BASIS_VALUES.includes(
        escalation.provenance.evidence_basis
      )
    ) {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        `${path}.provenance.evidence_basis must be one of: ${WORK_RECORD_ESCALATION_PROVENANCE_EVIDENCE_BASIS_VALUES.join(", ")}`,
        { path: `${path}.provenance.evidence_basis` }
      );
    }
  }
}

function validateProjection(diagnostics, projection, path, sourceDigest, recordId) {
  if (!isObject(projection)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  validateStringField(diagnostics, projection, "schema_version", {
    path: `${path}.schema_version`
  });
  if (isString(projection.schema_version) && projection.schema_version !== WORK_RECORD_RENDER_SCHEMA_VERSION) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.schema_version must be ${WORK_RECORD_RENDER_SCHEMA_VERSION}`,
      { path: `${path}.schema_version` }
    );
  }
  validateStringField(diagnostics, projection, "projection_id", { path: `${path}.projection_id` });
  validateStringField(diagnostics, projection, "projection_kind", {
    path: `${path}.projection_kind`
  });
  if (
    isString(projection.projection_kind) &&
    !WORK_RECORD_PROJECTION_KIND_VALUES.includes(projection.projection_kind)
  ) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.projection_kind must be one of: ${WORK_RECORD_PROJECTION_KIND_VALUES.join(", ")}`,
      { path: `${path}.projection_kind` }
    );
  }
  validateStringField(diagnostics, projection, "source_record_id", {
    path: `${path}.source_record_id`
  });
  if (isString(projection.source_record_id) && recordId && projection.source_record_id !== recordId) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.source_record_id must be ${recordId}`,
      { path: `${path}.source_record_id` }
    );
  }
  validateStringField(diagnostics, projection, "source_schema_version", {
    path: `${path}.source_schema_version`
  });
  if (
    isString(projection.source_schema_version) &&
    projection.source_schema_version !== WORK_RECORD_SCHEMA_VERSION
  ) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.source_schema_version must be ${WORK_RECORD_SCHEMA_VERSION}`,
      { path: `${path}.source_schema_version` }
    );
  }
  validateStringField(diagnostics, projection, "source_digest", {
    path: `${path}.source_digest`
  });
  if (isString(projection.source_digest) && !SHA256_PATTERN.test(projection.source_digest)) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.source_digest must match ${SHA256_PATTERN}`,
      { path: `${path}.source_digest` }
    );
  }
  if (!hasOwn(projection, "renderer") || !isObject(projection.renderer)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.renderer must be an object`, {
      path: `${path}.renderer`
    });
  } else {
    validateStringField(diagnostics, projection.renderer, "name", {
      path: `${path}.renderer.name`
    });
    validateStringField(diagnostics, projection.renderer, "version", {
      path: `${path}.renderer.version`
    });
  }
  validateStringField(diagnostics, projection, "generated_at", { path: `${path}.generated_at` });
  if (hasOwn(projection, "output_path") && !isNullableString(projection.output_path)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.output_path must be a string or null`, {
      path: `${path}.output_path`
    });
  }
  validateStringArrayField(diagnostics, projection, "omitted_fields", {
    path: `${path}.omitted_fields`,
    required: false
  });
  validateStringArrayField(diagnostics, projection, "compacted_fields", {
    path: `${path}.compacted_fields`,
    required: false
  });
  validateStringField(diagnostics, projection, "authority", { path: `${path}.authority` });
  if (isString(projection.authority) && projection.authority !== WORK_RECORD_PROJECTION_AUTHORITY) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.authority must be ${WORK_RECORD_PROJECTION_AUTHORITY}`,
      { path: `${path}.authority` }
    );
  }

  if (
    isString(projection.source_digest) &&
    SHA256_PATTERN.test(projection.source_digest) &&
    sourceDigest &&
    projection.source_digest !== sourceDigest
  ) {
    addDiagnostic(
      diagnostics,
      "stale_projection",
      `${path}.source_digest does not match canonical source digest`,
      { severity: "warning", path: `${path}.source_digest` }
    );
  }
}

function validateDerivedEvidence(diagnostics, evidence, path, recordId, recordRepo = null) {
  if (!isObject(evidence)) {
    addDiagnostic(diagnostics, "invalid_record", `${path} must be an object`, { path });
    return;
  }

  validateStringField(diagnostics, evidence, "schema_version", {
    path: `${path}.schema_version`
  });
  if (
    isString(evidence.schema_version) &&
    evidence.schema_version !== WORK_RECORD_DERIVED_EVIDENCE_SCHEMA_VERSION
  ) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.schema_version must be ${WORK_RECORD_DERIVED_EVIDENCE_SCHEMA_VERSION}`,
      { path: `${path}.schema_version` }
    );
  }

  validateStringField(diagnostics, evidence, "record_id", {
    path: `${path}.record_id`
  });
  if (isString(evidence.record_id) && recordId && evidence.record_id !== recordId) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.record_id must be ${recordId}`,
      { path: `${path}.record_id` }
    );
  }

  if (!hasOwn(evidence, "unit") || !isObject(evidence.unit)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.unit must be an object`, {
      path: `${path}.unit`
    });
  } else {
    validateStringField(diagnostics, evidence.unit, "kind", { path: `${path}.unit.kind` });
    validateStringField(diagnostics, evidence.unit, "address", { path: `${path}.unit.address` });
    validateStringField(diagnostics, evidence.unit, "record_id", { path: `${path}.unit.record_id` });
    if (isString(evidence.unit.record_id) && recordId && evidence.unit.record_id !== recordId) {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        `${path}.unit.record_id must be ${recordId}`,
        { path: `${path}.unit.record_id` }
      );
    }
    if (hasOwn(evidence.unit, "slice_id") && !isNullableString(evidence.unit.slice_id)) {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        `${path}.unit.slice_id must be a string or null`,
        { path: `${path}.unit.slice_id` }
      );
    }
  }

  validateStringField(diagnostics, evidence, "source_record_digest", {
    path: `${path}.source_record_digest`
  });
  if (
    isString(evidence.source_record_digest) &&
    !SHA256_PATTERN.test(evidence.source_record_digest)
  ) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.source_record_digest must match ${SHA256_PATTERN}`,
      { path: `${path}.source_record_digest` }
    );
  }

  if (!hasOwn(evidence, "generator") || !isObject(evidence.generator)) {
    addDiagnostic(diagnostics, "invalid_record", `${path}.generator must be an object`, {
      path: `${path}.generator`
    });
  } else {
    validateStringField(diagnostics, evidence.generator, "name", {
      path: `${path}.generator.name`
    });
    validateStringField(diagnostics, evidence.generator, "version", {
      path: `${path}.generator.version`
    });
  }

  validateStringField(diagnostics, evidence, "generated_at", {
    path: `${path}.generated_at`
  });

  validateStringField(diagnostics, evidence, "decision_kind", {
    path: `${path}.decision_kind`
  });
  if (
    isString(evidence.decision_kind) &&
    evidence.decision_kind !== WORK_RECORD_DERIVED_EVIDENCE_DECISION_KIND_VALUES[0]
  ) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      `${path}.decision_kind must be work_unit_atomicity`,
      { path: `${path}.decision_kind` }
    );
  }

  validateWorkerAdmissionDerivedEvidenceStructure(diagnostics, evidence, path, {
    recordId,
    recordRepo,
    expectedUnit: evidence.unit
  });
}

function validateMigrationReviewAcknowledgement(diagnostics, migration) {
  if (!hasOwn(migration, "review_acknowledgement")) {
    return;
  }

  const acknowledgement = migration.review_acknowledgement;
  if (acknowledgement === null) {
    if (migration.review_state === "reviewed") {
      addDiagnostic(
        diagnostics,
        "invalid_record",
        "migration.review_acknowledgement is required when migration.review_state is reviewed",
        { path: "migration.review_acknowledgement" }
      );
    }
    return;
  }

  if (!isObject(acknowledgement)) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      "migration.review_acknowledgement must be null or an object",
      { path: "migration.review_acknowledgement" }
    );
    return;
  }

  validateStringField(diagnostics, acknowledgement, "reviewed_at", {
    path: "migration.review_acknowledgement.reviewed_at"
  });
  validateStringField(diagnostics, acknowledgement, "reviewed_by", {
    path: "migration.review_acknowledgement.reviewed_by"
  });
  validateStringField(diagnostics, acknowledgement, "reviewed_via", {
    path: "migration.review_acknowledgement.reviewed_via"
  });
  validateNullableStringField(diagnostics, acknowledgement, "note", {
    path: "migration.review_acknowledgement.note"
  });

  if (migration.review_state !== "reviewed") {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      "migration.review_state must be reviewed when migration.review_acknowledgement is present",
      { path: "migration.review_state" }
    );
  }
}

function validateMigration(diagnostics, migration) {
  if (migration === null || migration === undefined) {
    return;
  }
  if (!isObject(migration)) {
    addDiagnostic(diagnostics, "invalid_record", "migration must be null or an object", {
      path: "migration"
    });
    return;
  }
  validateStringField(diagnostics, migration, "source_path", { path: "migration.source_path" });
  validateStringField(diagnostics, migration, "source_digest", { path: "migration.source_digest" });
  if (isString(migration.source_digest) && !SHA256_PATTERN.test(migration.source_digest)) {
    addDiagnostic(
      diagnostics,
      "invalid_record",
      "migration.source_digest must match sha256:<hex>",
      { path: "migration.source_digest" }
    );
  }
  validateStringField(diagnostics, migration, "migrated_at", { path: "migration.migrated_at" });
  validateStringField(diagnostics, migration, "decision_code", { path: "migration.decision_code" });
  validateStringArrayField(diagnostics, migration, "review_required_fields", {
    path: "migration.review_required_fields"
  });
  if (hasOwn(migration, "review_state")) {
    validateEnumField(diagnostics, migration, "review_state", WORK_RECORD_MIGRATION_REVIEW_STATE_VALUES, {
      path: "migration.review_state"
    });
  }
  validateMigrationReviewAcknowledgement(diagnostics, migration);
}

function validateSections(diagnostics, sections) {
  if (!isObject(sections)) {
    addDiagnostic(diagnostics, "invalid_record", "sections must be an object", { path: "sections" });
    return;
  }
  validateStringField(diagnostics, sections, "summary", {
    path: "sections.summary",
    allowEmpty: true
  });
  validateStringField(diagnostics, sections, "why_it_matters", {
    path: "sections.why_it_matters",
    allowEmpty: true
  });
  validateScope(diagnostics, sections.scope, "sections.scope");
  validateTasks(diagnostics, sections.tasks, "sections.tasks");
  validateStringArrayField(diagnostics, sections, "references", { path: "sections.references" });
  validateStringField(diagnostics, sections, "agent_notes", {
    path: "sections.agent_notes",
    allowEmpty: true
  });
  validateClosure(diagnostics, sections.closure, "sections.closure");
}

function validateCompletionPolicy(diagnostics, record) {
  if (hasOwn(record, "completion_policy")) {
    validateControlledStringField(
      diagnostics,
      record,
      "completion_policy",
      WORK_RECORD_COMPLETION_POLICY_VALUES,
      { path: "completion_policy" }
    );
  }
}

function validateTopLevelArrays(diagnostics, record) {
  validateCompletionPolicy(diagnostics, record);

  for (const field of REQUIRED_ARRAY_OF_STRING_TOP_LEVEL_FIELDS) {
    validateStringArrayField(diagnostics, record, field, { path: field });
  }
  for (const field of OPTIONAL_ARRAY_OF_STRING_TOP_LEVEL_FIELDS) {
    validateStringArrayField(diagnostics, record, field, {
      path: field,
      required: false
    });
  }
  for (const field of OPTIONAL_NON_NEGATIVE_INTEGER_TOP_LEVEL_FIELDS) {
    validateNullableNonNegativeIntegerField(diagnostics, record, field, {
      path: field,
      required: false
    });
  }

  if (hasOwn(record, "children") && !Array.isArray(record.children)) {
    addDiagnostic(diagnostics, "invalid_record", "children must be an array", { path: "children" });
  } else if (Array.isArray(record.children)) {
    record.children.forEach((child, index) => validateChildReference(diagnostics, child, `children[${index}]`));
  }

  if (hasOwn(record, "slices") && !Array.isArray(record.slices)) {
    addDiagnostic(diagnostics, "invalid_record", "slices must be an array", { path: "slices" });
  } else if (Array.isArray(record.slices)) {
    record.slices.forEach((slice, index) => validateSlice(diagnostics, slice, `slices[${index}]`));
  }

  if (hasOwn(record, "escalations") && !Array.isArray(record.escalations)) {
    addDiagnostic(diagnostics, "invalid_record", "escalations must be an array", {
      path: "escalations"
    });
  } else if (Array.isArray(record.escalations)) {
    record.escalations.forEach((escalation, index) =>
      validateEscalation(diagnostics, escalation, `escalations[${index}]`)
    );
  }

  if (hasOwn(record, "projections") && !Array.isArray(record.projections)) {
    addDiagnostic(diagnostics, "invalid_record", "projections must be an array", {
      path: "projections"
    });
  }

  if (hasOwn(record, "derived_evidence") && !Array.isArray(record.derived_evidence)) {
    addDiagnostic(diagnostics, "invalid_record", "derived_evidence must be an array", {
      path: "derived_evidence"
    });
  }
}

export {
  validateTopLevelArrays,
  validateDispatchIntent,
  validateAcceptance,
  validateSections,
  validateMigration,
  validateExpectedEditTargets,
  validateProjection,
  validateDerivedEvidence
};
