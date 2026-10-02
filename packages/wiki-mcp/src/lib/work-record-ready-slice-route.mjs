

import { resolveWorkspaceRepo } from "./workspace-repo-resolution.mjs";
import { jsonContent } from "./mcp-response.mjs";
import {
  presentControlledAcceptanceState,
  projectPublicationOutcome,
  resolveExpectedSourceDigest,
  workRecordFreshnessSource
} from "./work-record-write-route-helpers.mjs";
import { projectOrdinaryWriteFreshness } from "./write-response-boundary.mjs";
import {
  readyWorkRecordSliceByUnit
} from "@agent-chassis/wiki-core/src/operations/work-record-contract-edit.mjs";
import {
  loadWorkRecordById
} from "@agent-chassis/wiki-core/src/lib/work-record-store.mjs";
import {
  computeWorkRecordSourceDigest
} from "@agent-chassis/wiki-core/src/lib/work-record-schema.mjs";
import {
  computeReviewedUnitSourceDigest
} from "@agent-chassis/wiki-core/src/lib/work-record-review-attestation.mjs";

const loadClassifyControlledAcceptanceStateOperation = async () => (
  await import("@agent-chassis/wiki-core/src/operations/controlled-contract.mjs")
).classifyControlledAcceptanceStateOperation;
import {
  projectWorkRecordTestProofValidation
} from "@agent-chassis/wiki-core/src/lib/work-record-test-proof-bindings.mjs";
import {
  classifyMechanicalRuntimeBlocker
} from "./dispatch-tools/runtime-blocker-classifier.mjs";

const READY_SLICE_STRUCTURAL_READINESS_SCHEMA_VERSION =
  "ready-slice-structural-readiness.v1";
const READY_SLICE_BLOCKER_CODE = "work_record_readiness_failure";
const READY_SLICE_PROVENANCE_VALUES = new Set([
  "authored_record",
  "derived_normalizer",
  "derived_code_graph",
  "derived_diff",
  "derived_policy_pack",
  "unavailable",
  "not_applicable"
]);
const READY_SLICE_VERIFICATION_METHOD_VALUES = new Set([
  "inspection",
  "analysis",
  "demonstration",
  "test_execution",
  "audit",
  "proof"
]);
const READY_SLICE_TARGET_KIND_VALUES = new Set([
  "function",
  "method",
  "class",
  "module",
  "export",
  "test_case",
  "schema_field",
  "docs_section",
  "config_key",
  "other"
]);
const READY_SLICE_TARGET_OPERATION_VALUES = new Set([
  "create",
  "modify",
  "delete",
  "inspect"
]);
const READY_SLICE_ACTIVITY_KIND_VALUES = new Set([
  "requirements_analysis",
  "design_contract",
  "implementation_new",
  "implementation_modify",
  "implementation_remove",
  "verification_test_authoring",
  "verification_test_modification",
  "validation_runtime_check",
  "documentation",
  "migration_contract",
  "coordination_record",
  "configuration"
]);
const READY_SLICE_ARTIFACT_KIND_VALUES = new Set([
  "production_code_module",
  "production_code_export",
  "unit_test",
  "integration_test",
  "operational_test",
  "property_test",
  "regression_test",
  "fixture_corpus",
  "cli_entrypoint",
  "launcher_wrapper",
  "mcp_tool_surface",
  "schema_contract",
  "policy_rule",
  "protocol_doc",
  "reference_doc",
  "wiki_record_canonical",
  "wiki_projection_generated",
  "build_or_config"
]);
const READY_SLICE_GRANULARITY_VALUES = new Set([
  "file",
  "module",
  "function",
  "method",
  "class",
  "export",
  "test_case",
  "schema_field",
  "docs_section",
  "config_key",
  "record"
]);

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value ?? {}, key);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStrictProvenance(value, allowedKeys) {
  if (!isPlainObject(value)) {
    return false;
  }
  return Object.keys(value).every(
    (key) =>
      allowedKeys.has(key) &&
      (value[key] === null || READY_SLICE_PROVENANCE_VALUES.has(value[key]))
  );
}

function isCanonicalReadySliceCriterion(value) {
  if (isNonemptyString(value)) {
    return true;
  }
  if (!isPlainObject(value)) {
    return false;
  }
  const allowed = new Set([
    "text",
    "verification_method",
    "evidence_target",
    "facet_provenance"
  ]);
  if (
    !Object.keys(value).every((key) => allowed.has(key)) ||
    !isNonemptyString(value.text)
  ) {
    return false;
  }
  if (
    hasOwn(value, "verification_method") &&
    value.verification_method !== null &&
    !READY_SLICE_VERIFICATION_METHOD_VALUES.has(value.verification_method)
  ) {
    return false;
  }
  if (
    hasOwn(value, "evidence_target") &&
    value.evidence_target !== null &&
    typeof value.evidence_target !== "string"
  ) {
    return false;
  }
  return (
    !hasOwn(value, "facet_provenance") ||
    isStrictProvenance(
      value.facet_provenance,
      new Set(["text", "verification_method", "evidence_target"])
    )
  );
}

function isCanonicalRepositoryPath(value) {
  if (!isNonemptyString(value) || value !== value.trim()) {
    return false;
  }
  const segments = value.split("/");
  return !(
    value.startsWith("./") ||
    value.startsWith("/") ||
    value.startsWith("~") ||
    /^[A-Za-z]:/u.test(value) ||
    value.includes("\\") ||
    value.includes("\0") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  );
}

function isCanonicalReadySliceTarget(value) {
  if (!isPlainObject(value)) {
    return false;
  }
  const allowed = new Set([
    "path",
    "name",
    "kind",
    "operation",
    "activity_kind",
    "artifact_kind",
    "granularity",
    "optional",
    "facet_provenance"
  ]);
  if (
    !Object.keys(value).every((key) => allowed.has(key)) ||
    !isCanonicalRepositoryPath(value.path) ||
    !isNonemptyString(value.name) ||
    !READY_SLICE_TARGET_KIND_VALUES.has(value.kind) ||
    !READY_SLICE_TARGET_OPERATION_VALUES.has(value.operation)
  ) {
    return false;
  }
  for (const [field, values] of [
    ["activity_kind", READY_SLICE_ACTIVITY_KIND_VALUES],
    ["artifact_kind", READY_SLICE_ARTIFACT_KIND_VALUES],
    ["granularity", READY_SLICE_GRANULARITY_VALUES]
  ]) {
    if (hasOwn(value, field) && value[field] !== null && !values.has(value[field])) {
      return false;
    }
  }
  if (hasOwn(value, "optional") && typeof value.optional !== "boolean") {
    return false;
  }
  return (
    !hasOwn(value, "facet_provenance") ||
    isStrictProvenance(
      value.facet_provenance,
      new Set([
        "path",
        "name",
        "kind",
        "operation",
        "activity_kind",
        "artifact_kind",
        "granularity",
        "optional"
      ])
    )
  );
}

function scalarCheck(unit, field, check, pathValue) {
  let status;
  if (!hasOwn(unit, field)) {
    status = "missing";
  } else if (typeof unit[field] !== "string") {
    status = "mismatch";
  } else if (unit[field].trim().length === 0) {
    status = "empty";
  } else {
    status = "ready";
  }
  return { check, status, path: pathValue };
}

function arrayCheck(unit, field, check, pathValue, predicate = isNonemptyString) {
  let status;
  if (!hasOwn(unit, field)) {
    status = "missing";
  } else if (!Array.isArray(unit[field])) {
    status = "mismatch";
  } else if (unit[field].length === 0) {
    status = "empty";
  } else if (!unit[field].every(predicate)) {
    status = "mismatch";
  } else {
    status = "ready";
  }
  return { check, status, path: pathValue };
}

function nestedArrayCheck(unit, parentField, field, check, pathValue, predicate) {
  const parent = unit?.[parentField];
  let status;
  if (!isPlainObject(parent) || !hasOwn(parent, field)) {
    status = "missing";
  } else if (!Array.isArray(parent[field])) {
    status = "mismatch";
  } else if (parent[field].length === 0) {
    status = "empty";
  } else if (!parent[field].every(predicate)) {
    status = "mismatch";
  } else {
    status = "ready";
  }
  return { check, status, path: pathValue };
}

function acceptanceValidationCheck(unit) {
  const check = "acceptance_validation_nonempty";
  const pathValue = "acceptance.validation";
  const acceptance = unit?.acceptance;
  if (!isPlainObject(acceptance) || !hasOwn(acceptance, "validation")) {
    return { check, status: "missing", path: pathValue };
  }
  const section = acceptance.validation;
  if (Array.isArray(section) && section.length === 0) {
    return { check, status: "empty", path: pathValue };
  }
  const projection = projectWorkRecordTestProofValidation({
    selectedUnit: { acceptance: { validation: section } },
    path: pathValue
  });
  return {
    check,
    status: projection.status === "valid" ? "ready" : "mismatch",
    path: pathValue
  };
}

function shapingTupleCheck(unit) {
  const check = "shaping_tuple_consistent";
  const pathValue = "dispatch_intent";
  if (!hasOwn(unit, "work_kind") || !hasOwn(unit, "dispatch_intent")) {
    return { check, status: "missing", path: pathValue };
  }
  const roles = {
    implementation: "worker",
    review: "reviewer",
    redteam: "redteam"
  };
  const intent = unit.dispatch_intent;
  const status =
    isPlainObject(intent) &&
    roles[unit.work_kind] !== undefined &&
    intent.intended_agent_role === roles[unit.work_kind] &&
    intent.target_unit === "slice" &&
    typeof intent.requires_graph_impact === "boolean" &&
    typeof intent.requires_escalation === "boolean"
      ? "ready"
      : "mismatch";
  return { check, status, path: pathValue };
}

function notApplicable(check, pathValue) {
  return { check, status: "not_applicable", path: pathValue };
}

function readinessBlockers(checks) {
  return checks.flatMap((entry) => {
    if (!["missing", "empty", "mismatch", "error"].includes(entry.status)) return [];
    const classification = classifyMechanicalRuntimeBlocker({
      producer: "authored_readiness",
      condition: "named_contract_defect",
      named_defect: {
        check: entry.check,
        status: entry.status,

        path: entry.path
      }
    });
    return [
      {
        code: classification.code,
        check: entry.check,
        status: entry.status,
        path: entry.path,
        authority_limb: classification.authority_limb,
        cause: classification.cause,
        actor_recovery: classification.actor_recovery,

        next_action: readySliceBlockerNextAction(entry)
      }
    ];
  });
}

function readySliceBlockerNextAction({ check, status, path: pathValue }) {
  const location = typeof pathValue === "string" && pathValue.length > 0
    ? pathValue
    : "the selected slice contract";
  if (status === "missing") {
    return `Add the required ${check} content at ${location} on the selected slice, then re-run workspace_work_record_ready_slice`;
  }
  if (status === "empty") {
    return `Populate ${location} — the ${check} check found it present but empty — then re-run workspace_work_record_ready_slice`;
  }
  return `Correct ${location} so the ${check} check is consistent, then re-run workspace_work_record_ready_slice`;
}

export function projectReadySliceStructuralReadiness({
  record,
  selectedUnit,
  coreResult,
  computeSourceDigest = computeWorkRecordSourceDigest,
  computeReviewedDigest = computeReviewedUnitSourceDigest
}) {
  if (
    !isPlainObject(record) ||
    !isPlainObject(selectedUnit) ||
    selectedUnit.kind !== "slice" ||
    !/^WK-[0-9]{4}$/.test(selectedUnit.record_id ?? "") ||
    !/^SLICE-[0-9]{3}$/.test(selectedUnit.slice_id ?? "") ||
    selectedUnit.address !== `${selectedUnit.record_id}#${selectedUnit.slice_id}` ||
    record.id !== selectedUnit.record_id
  ) {
    throw new Error("persisted selected unit is unavailable");
  }
  const matches = Array.isArray(record.slices)
    ? record.slices.filter((slice) => slice?.id === selectedUnit.slice_id)
    : [];
  if (matches.length !== 1) {
    throw new Error("persisted selected unit is ambiguous");
  }
  const unit = matches[0];
  const sourceDigest = computeSourceDigest(record);
  const reviewedUnitDigest = computeReviewedDigest({
    record,
    slice_id: selectedUnit.slice_id
  });
  if (
    !/^sha256:[0-9a-f]{64}$/.test(sourceDigest ?? "") ||
    !/^sha256:[0-9a-f]{64}$/.test(reviewedUnitDigest ?? "")
  ) {
    throw new Error("persisted digest projection failed");
  }

  const checks = [
    scalarCheck(unit, "title", "title_nonempty", "title"),
    arrayCheck(unit, "read_scope", "read_scope_nonempty", "read_scope"),
    arrayCheck(unit, "repo_paths", "repo_paths_nonempty", "repo_paths"),
    nestedArrayCheck(
      unit,
      "acceptance",
      "criteria",
      "acceptance_criteria_nonempty",
      "acceptance.criteria",
      isCanonicalReadySliceCriterion
    ),
    acceptanceValidationCheck(unit),
    shapingTupleCheck(unit)
  ];

  if (unit.work_kind === "implementation") {
    checks.push(
      arrayCheck(
        unit,
        "write_scope",
        "implementation_write_scope_nonempty",
        "write_scope"
      ),
      arrayCheck(
        unit,
        "expected_edit_targets",
        "implementation_expected_edit_targets_nonempty",
        "expected_edit_targets",
        isCanonicalReadySliceTarget
      ),
      notApplicable("findings_only_write_scope_empty", "write_scope")
    );
  } else if (unit.work_kind === "review" || unit.work_kind === "redteam") {
    let findingsStatus;
    if (!hasOwn(unit, "write_scope")) {
      findingsStatus = "missing";
    } else if (!Array.isArray(unit.write_scope) || unit.write_scope.length > 0) {
      findingsStatus = "mismatch";
    } else {
      findingsStatus = "ready";
    }
    checks.push(
      notApplicable("implementation_write_scope_nonempty", "write_scope"),
      notApplicable(
        "implementation_expected_edit_targets_nonempty",
        "expected_edit_targets"
      ),
      {
        check: "findings_only_write_scope_empty",
        status: findingsStatus,
        path: "write_scope"
      }
    );
  } else {
    throw new Error("persisted work_kind is outside ready-slice shaping");
  }

  const blockers = readinessBlockers(checks);
  return {
    schema_version: READY_SLICE_STRUCTURAL_READINESS_SCHEMA_VERSION,
    selected_unit: {
      kind: "slice",
      address: selectedUnit.address,
      record_id: selectedUnit.record_id,
      slice_id: selectedUnit.slice_id
    },

    contract_persisted: coreResult?.contract_persisted ?? null,
    ...projectPublicationOutcome(coreResult),
    no_op: Boolean(coreResult?.no_op),
    ...(hasOwn(coreResult, "ok") ? { ok: Boolean(coreResult.ok) } : {}),
    source_digest: sourceDigest,
    reviewed_unit_digest: reviewedUnitDigest,
    generation_transition: coreResult?.generation_transition ?? null,
    structurally_complete: blockers.length === 0,
    checks,
    blockers
  };
}

function projectionFailureClassification() {
  return classifyMechanicalRuntimeBlocker({
    producer: "operator_recovery",
    condition: "runtime_materialization_failed",
    detail: { issue: "ready_slice_structural_projection_failed" }
  });
}

function projectionFailureReadySliceResult(coreResult, diagnostics = []) {
  const check = { check: "projection_internal", status: "error", path: null };
  const classification = projectionFailureClassification();
  const result = {
    schema_version: READY_SLICE_STRUCTURAL_READINESS_SCHEMA_VERSION,
    selected_unit: {
      kind: "slice",
      address: coreResult.selected_unit.address,
      record_id: coreResult.selected_unit.record_id,
      slice_id: coreResult.selected_unit.slice_id
    },
    contract_persisted: coreResult?.contract_persisted ?? null,
    ...projectPublicationOutcome(coreResult),
    no_op: Boolean(coreResult.no_op),
    source_digest: coreResult.source_digest,
    reviewed_unit_digest: coreResult.reviewed_unit_digest,
    generation_transition: coreResult.generation_transition ?? null,
    structurally_complete: false,
    checks: [check],
    blockers: [
      {
        code: classification.code,
        ...check,
        authority_limb: classification.authority_limb,
        cause: classification.cause,
        actor_recovery: classification.actor_recovery,
        next_action:
          "Re-run workspace_work_record_ready_slice; if the structural projection keeps failing, report the runtime failure to the operator. The contract is already persisted — do not revise it for this blocker."
      }
    ]
  };
  if (diagnostics.length > 0) {
    return {
      ...coreResult,
      ...result,
      diagnostics,
      diagnostic_count: diagnostics.length
    };
  }
  return result;
}

const READY_SLICE_NONACTIONABLE_DIAGNOSTIC_CODES = new Set([
  "ready_slice_diff_truncated"
]);

function actionableReadySliceDiagnostics(diagnostics) {
  return (Array.isArray(diagnostics) ? diagnostics : []).filter((diagnostic) =>
    !READY_SLICE_NONACTIONABLE_DIAGNOSTIC_CODES.has(diagnostic?.code) &&
    (diagnostic?.severity === "warning" || diagnostic?.severity === "error")
  );
}

function coreReadySliceOutcomeRequiresDetail(coreResult) {
  return coreResult?.ok === false ||
    (typeof coreResult?.publication_state === "string" &&
      coreResult.publication_state !== "published") ||
    (coreResult?.failed_fault !== undefined && coreResult.failed_fault !== null) ||
    (typeof coreResult?.next_action === "string" &&
      coreResult.next_action.trim().length > 0) ||
    coreResult?.admission_sidecar_cleanup?.ok === false;
}

function detailedReadySliceSuccessResult({
  coreResult,
  projection,
  coreDiagnostics,
  reloadDiagnostics
}) {
  const diagnostics = [...coreDiagnostics, ...reloadDiagnostics];
  const hasProjectionBlockers =
    Array.isArray(projection?.blockers) && projection.blockers.length > 0;
  const coreRequiresDetail =
    actionableReadySliceDiagnostics(coreDiagnostics).length > 0 ||
    coreReadySliceOutcomeRequiresDetail(coreResult);
  const reloadRequiresDetail =
    actionableReadySliceDiagnostics(reloadDiagnostics).length > 0;

  if (hasProjectionBlockers && (coreRequiresDetail || reloadRequiresDetail)) {
    return {
      ...projection,
      ...coreResult,
      structurally_complete: projection.structurally_complete,
      checks: projection.checks,
      blockers: projection.blockers,
      diagnostics,
      diagnostic_count: diagnostics.length
    };
  }
  if (hasProjectionBlockers) return projection;
  if (coreRequiresDetail) {
    return {
      ...coreResult,
      diagnostics,
      diagnostic_count: diagnostics.length
    };
  }
  if (reloadRequiresDetail) {
    return {
      ...projection,
      diagnostics: reloadDiagnostics,
      diagnostic_count: reloadDiagnostics.length
    };
  }
  return null;
}

const respond = (value) => jsonContent(projectOrdinaryWriteFreshness(value));

export async function runWorkspaceWorkRecordReadySliceRoute({
  workspaceRepos,
  args,
  dependencies = {}
}) {
  const resolveWorkspace =
    dependencies.resolveWorkspaceRepo ?? resolveWorkspaceRepo;
  const runCore =
    dependencies.readyWorkRecordSliceByUnit ?? readyWorkRecordSliceByUnit;
  const loadPersisted =
    dependencies.loadWorkRecordById ?? loadWorkRecordById;
  const projectStructural =
    dependencies.projectReadySliceStructuralReadiness ??
    projectReadySliceStructuralReadiness;
  const workspace = resolveWorkspace(workspaceRepos, args.repo);
  const { repo: _repo, ...request } = args;
  const loadControlledAcceptanceParent = dependencies.loadControlledAcceptanceParent ??
    loadWorkRecordById;
  const parent = await loadControlledAcceptanceParent({ dir: workspace.dir, id: request.unit })
    .catch(() => null);

  const freshness = await resolveExpectedSourceDigest(request.expected_source_digest ?? null,
    { load: workRecordFreshnessSource(workspace.dir, request.unit) });
  if (!freshness.ok) {
    return respond({
      ok: false,
      written: false,
      contract_persisted: false,
      no_op: false,
      selected_unit: { kind: "slice",
        address: request.slice_id ? `${request.unit}#${request.slice_id}` : request.unit,
        record_id: request.unit, slice_id: request.slice_id ?? null },
      diagnostics: [freshness.diagnostic],
      ...(freshness.stale ? { source_digest: freshness.current_source_digest,
        expected_source_digest: request.expected_source_digest,
        current_source_digest: freshness.current_source_digest } : {}),
      ...(freshness.next_action === undefined ? {} : { next_action: freshness.next_action })
    });
  }
  if (freshness.value !== null) request.expected_source_digest = freshness.value;
  const existingSlice = Array.isArray(parent?.record?.slices) && request.slice_id
    ? parent.record.slices.find(({ id }) => id === request.slice_id) ?? null
    : null;
  const effectiveShape = request.shaping_mode ?? (
    existingSlice?.work_kind === "review" ? "reviewer"
      : existingSlice?.work_kind === "redteam" ? "redteam"
        : request.work_kind === "review" ? "reviewer"
          : request.work_kind === "redteam" ? "redteam" : "implementation"
  );

  const allocating = !Object.hasOwn(request, "slice_id") ||
    request.slice_id === undefined || request.slice_id === null;
  const selectedUnit = allocating ? null : request.slice_id;
  const gated = parent?.valid === true && effectiveShape === "implementation" &&
    (allocating || existingSlice !== null);
  if (gated) {
    let state;
    const classifyControlledAcceptanceState =
      dependencies.classifyControlledAcceptanceState ??
      await loadClassifyControlledAcceptanceStateOperation();
    try {
      state = await classifyControlledAcceptanceState({
        repoRoot: workspace.dir,
        wkId: request.unit,
        selectedUnit,
        record: parent.record
      });
    } catch (error) {
      const recovery = Object.freeze({
        status: "system_owner_failure",
        actor_recovery: "system_owner",
        explanation: "Controlled-acceptance classification failed internally; no authored-input correction is established.",
        source_code: error?.code ?? null,
        source_details: structuredClone(error?.details ?? null)
      });
      return respond({
        schema_version: READY_SLICE_STRUCTURAL_READINESS_SCHEMA_VERSION,
        selected_unit: { kind: "slice",
          address: request.slice_id ? `${request.unit}#${request.slice_id}` : request.unit,
          record_id: request.unit, slice_id: request.slice_id ?? null },
        contract_persisted: false, written: false, no_op: true,
        source_digest: parent.source_digest ?? null, structurally_complete: false,
        controlled_acceptance_state: null,
        controlled_acceptance_refusal: {
          schema_version: "controlled-acceptance-structural-refusal.v1",
          code: error?.code ?? "controlled_acceptance_proof_posture_invalid",
          source_code: error?.code ?? null,
          source_details: error?.details ?? null,
          wk_id: request.unit,
          selected_unit: selectedUnit,
          reason: error?.message ?? "controlled-acceptance proof posture is invalid"
        },
        checks: [{ check: "controlled_acceptance_state", status: "error",
          path: "proof_posture" }],
        blockers: [{ code: error?.code ?? "controlled_acceptance_proof_posture_invalid",
          check: "controlled_acceptance_state", status: "error",
          path: "proof_posture", authority_limb: "mechanical",
          cause: error?.code ?? "controlled_acceptance_proof_posture_invalid",
          actor_recovery: "system_owner",
          next_action: recovery.explanation }],
        controlled_acceptance_recovery: recovery,
        next_calls: []
      });
    }

    if (!state.semantic.admission.admits) {
      const code = state.semantic.admission.blocked_reason_code;
      const admission = state.semantic.admission;
      const recovery = admission.recovery_capability ?? null;
      const supportedNextCall = admission.supported_next_call ?? null;
      return respond({
        schema_version: READY_SLICE_STRUCTURAL_READINESS_SCHEMA_VERSION,
        selected_unit: { kind: "slice",
          address: request.slice_id ? `${request.unit}#${request.slice_id}` : request.unit,
          record_id: request.unit, slice_id: request.slice_id ?? null },
        contract_persisted: false,
        written: false,
        no_op: true,
        source_digest: parent.source_digest ?? null,
        structurally_complete: false,
        controlled_acceptance_state: presentControlledAcceptanceState(state),
        checks: [{ check: "controlled_acceptance_state", status: "error",
          path: "proof_posture" }],
        blockers: [{ code, check: "controlled_acceptance_state", status: "error",
          path: "proof_posture",
          authority_limb: "mechanical",
          cause: code,
          actor_recovery: recovery?.actor_recovery ?? "none",
          next_action: supportedNextCall === null
            ? admission.recovery_explanation ??
              "Inspect the reported semantic causes; no authenticated correction is available"
            : recovery?.status === "authored_correction_available"
              ? "Inspect the reported causes, then use the authenticated authoring correction"
              : "Inspect the reported semantic causes" }],
        controlled_acceptance_recovery: recovery,
        next_calls: supportedNextCall === null ? [] : [supportedNextCall]
      });
    }
  }
  const coreResult = await runCore({ dir: workspace.dir, request, repository: workspace.repo });

  if (coreResult?.ok === false && typeof coreResult?.publication_state === "string") {
    return respond(coreResult);
  }
  if (coreResult?.contract_persisted !== true) {
    return respond(coreResult);
  }

  let reloadDiagnostics = [];
  try {
    const loaded = await loadPersisted({
      dir: workspace.dir,
      id: coreResult.selected_unit.record_id
    });
    reloadDiagnostics = Array.isArray(loaded?.diagnostics)
      ? loaded.diagnostics : [];
    if (
      !loaded?.record ||
      reloadDiagnostics.some((diagnostic) => diagnostic?.severity === "error")
    ) {
      throw new Error("persisted record reload failed");
    }
    const projection = projectStructural({
      record: loaded.record,
      selectedUnit: coreResult.selected_unit,
      coreResult,
      computeSourceDigest:
        dependencies.computeWorkRecordSourceDigest ?? computeWorkRecordSourceDigest,
      computeReviewedDigest:
        dependencies.computeReviewedUnitSourceDigest ?? computeReviewedUnitSourceDigest
    });
    const coreDiagnostics = Array.isArray(coreResult.diagnostics)
      ? coreResult.diagnostics : [];
    const detailed = detailedReadySliceSuccessResult({
      coreResult,
      projection,
      coreDiagnostics,
      reloadDiagnostics
    });
    if (detailed !== null) return respond(detailed);

    const acknowledgement = request.slice_id === undefined
      ? { ok: true, slice_id: coreResult.selected_unit.slice_id }
      : { ok: true };
    return respond(acknowledgement);
  } catch {
    const coreDiagnostics = Array.isArray(coreResult.diagnostics)
      ? coreResult.diagnostics : [];
    return respond(projectionFailureReadySliceResult(
      coreResult,
      [...coreDiagnostics, ...reloadDiagnostics]
    ));
  }
}
