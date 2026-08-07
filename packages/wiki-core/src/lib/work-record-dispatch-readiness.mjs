

import { validateAcceptanceCriterionEntry } from "./work-record-schema-validators.mjs";
import { buildNextCall } from "./next-calls-descriptor.mjs";
import {
  evaluateWorkRecordPolicy,
  normalizeWorkRecordPolicyPath
} from "./work-record-policy.mjs";
import { isMigrationReviewAcknowledged } from "./work-record-schema.mjs";
import {
  clone,
  isBashWrapperPath,
  isObject,
  uniqueBy
} from "./work-record-dispatch-shared.mjs";
import { chooseDecisionCode } from "./work-record-dispatch-decision.mjs";
import {
  collectGraphImpactSubjectPaths,
  graphImpactMatchesSubject,
  graphStateHasUnavailableSubjectPath,
  isCanonicalGraphImpactRef,
  isDirtyOverlayCompatibleGraphState,
  normalizeGraphState
} from "./work-record-dispatch-graph.mjs";
import {
  collectDependencyBlockers,
  resolveDependencyEvidenceVector
} from "./work-record-dispatch-dependencies.mjs";
import {
  buildPreparationAuditEnvelope,
  collectPreparationAuditBlockers,
  isPreparationAuditRequired,
  normalizePreparationAudit
} from "./work-record-dispatch-preparation-audit.mjs";
import { collectValidationHints } from "./work-record-dispatch-validation-hints.mjs";
import {
  collectDerivedEvidence,
  collectGraphImpactEvidence
} from "./work-record-dispatch-evidence.mjs";
import {
  collectAcceptedEscalations,
  maybeCollapseExtractionSpliceClusters,
  maybeCollapseShimClusters
} from "./work-record-dispatch-clusters.mjs";
import {
  compactAcceptedEscalation,
  createReadinessEnvelope
} from "./work-record-dispatch-readiness-shape.mjs";
import { evaluateGraphImpactBlocker } from "./runtime-blocker-taxonomy.mjs";

const GRAPH_IMPACT_TAXONOMY_STATE_VALUES = new Set([
  "available",
  "unavailable",
  "error",
  "query_error"
]);

export function normalizeDispatchGraphState(graphState = null) {
  const normalized = normalizeGraphState(graphState);
  const source = isObject(graphState) ? graphState : {};
  const explicitGraphState = GRAPH_IMPACT_TAXONOMY_STATE_VALUES.has(source.graph_state)
    ? source.graph_state
    : source.status_reason === "query_error"
      ? "query_error"
      : source.status_reason === "artifact_unreadable"
        ? "error"
        : source.status_reason === "graph_unavailable" || source.status_reason === "graph_absent"
          ? "unavailable"
          : normalized.graph_state;
  const explicitOverlayState = source.overlay_state === "active" || source.overlay_state === "included"
    ? "active"
    : source.overlay_state === "absent" || source.overlay_state === "not_included"
      ? "absent"
      : normalized.overlay_state
        ? normalized.overlay_state
        : isDirtyOverlayCompatibleGraphState(normalized)
          ? "active"
          : null;
  return {
    ...normalized,
    graph_state: explicitGraphState,
    overlay_state: explicitOverlayState
  };
}

const CANONICAL_DECISIONS_DIRECTORY = "wiki/decisions";

function normalizedWriteScopePathOrNull(entry) {
  try {
    return normalizeWorkRecordPolicyPath(entry).relative_path;
  } catch {
    return null;
  }
}

export function collectForbiddenDecisionsWriteScopePaths(writeScope) {
  if (!Array.isArray(writeScope)) {
    return [];
  }
  const forbidden = new Set();
  for (const entry of writeScope) {
    const relativePath = normalizedWriteScopePathOrNull(entry);
    if (!relativePath) {
      continue;
    }
    if (
      relativePath === CANONICAL_DECISIONS_DIRECTORY ||
      relativePath.startsWith(`${CANONICAL_DECISIONS_DIRECTORY}/`)
    ) {
      forbidden.add(relativePath);
    }
  }
  return [...forbidden].sort((left, right) => left.localeCompare(right));
}

function isCanonicalAcceptanceCriterion(entry) {
  const diagnostics = [];
  validateAcceptanceCriterionEntry(diagnostics, entry, "criteria", { allowString: true });
  return diagnostics.length === 0;
}

function findingsAcceptanceCriterionText(entry) {
  if (typeof entry === "string") {
    const text = entry.trim();
    return text ? text : null;
  }
  if (isObject(entry)) {
    if (typeof entry.text !== "string") {
      return null;
    }
    const text = entry.text.trim();
    return text ? text : null;
  }
  return null;
}

function classifyProspectiveReviewAcceptanceSection(section) {
  if (
    !isObject(section) ||
    !Array.isArray(section.criteria) ||
    !Array.isArray(section.validation)
  ) {
    return "invalid";
  }
  const criteriaEmpty = section.criteria.length === 0;
  const validationEmpty = section.validation.length === 0;
  if (criteriaEmpty && validationEmpty) {
    return "empty";
  }
  if (criteriaEmpty !== validationEmpty) {
    return "invalid";
  }
  for (const entry of section.criteria) {
    if (!isCanonicalAcceptanceCriterion(entry) || findingsAcceptanceCriterionText(entry) === null) {
      return "invalid";
    }
  }
  for (const entry of section.validation) {
    if (typeof entry !== "string" || entry.trim() === "") {
      return "invalid";
    }
  }
  return "valid";
}

function collectProspectiveSliceReviewAcceptanceBlocker(record, selectedUnit, unit) {
  const parentState = classifyProspectiveReviewAcceptanceSection(record?.acceptance);
  if (parentState === "invalid") {
    return {
      code: "missing_validation",
      remediation_unit: record.id,
      reason:
        `exact-slice review inherits parent acceptance from ${record.id}, but its acceptance is asymmetric or malformed; ` +
        `set both acceptance.criteria and acceptance.validation (or leave both empty) with workspace_work_record_set_acceptance on ${record.id}`
    };
  }
  const sliceState = classifyProspectiveReviewAcceptanceSection(selectedUnit?.acceptance);
  if (sliceState !== "valid") {
    return {
      code: "missing_validation",
      remediation_unit: unit.address,
      reason:
        `exact-slice review requires complete acceptance on the implementation slice ${unit.address}; ` +
        `set acceptance.criteria and acceptance.validation with workspace_work_record_set_acceptance on ${unit.address}`
    };
  }
  return null;
}

export function buildReadinessFromRecord({
  record,
  unit,
  selectedUnit,
  graphState,
  graphImpact,
  parserDiagnostics,
  policyResult,
  dependencyStatuses,
  additionalDependencyRecords,
  preparationAudit,
  now,
  reportOnly,
  readOnly,
  directImportAdjacency = null,
  graphBearingWriteScope = [],
  graphBearingImplementationWriteScope = [],
  graphImpactUnbuildable = false,
  graphImpactFailure = null,
  liveGraphState = null,
  admissionRecovery = null
}) {
  const subject = selectedUnit || record;
  const policy =
    policyResult ||
    evaluateWorkRecordPolicy(subject, {
      selected_unit: unit.kind === "slice" ? selectedUnit : null,
      graph_state: graphState,
      dirty_state: graphState.dirty_state,
      staleness: graphState.staleness,

      graph_import_adjacency: directImportAdjacency,
      graph_bearing_paths: graphBearingWriteScope
    });

  const blockers = [];
  const writeScope = Array.isArray(subject?.write_scope) ? subject.write_scope : [];
  const graphImpactSubjectPaths = collectGraphImpactSubjectPaths(subject);

  const graphBearingSubjectPaths = graphImpactSubjectPaths.filter(
    (subjectPath) => !isBashWrapperPath(subjectPath)
  );

  const dependencyEvidence = resolveDependencyEvidenceVector({
    record,
    selectedUnit,
    dependencyStatuses,
    additionalRecords: additionalDependencyRecords ?? new Map()
  });

  for (const dependencyBlocker of collectDependencyBlockers(dependencyEvidence)) {
    blockers.push(dependencyBlocker);
  }

  const normalizedAudit = normalizePreparationAudit(preparationAudit, now);
  const auditRequired = isPreparationAuditRequired(subject);
  const preparationAuditEnvelope = buildPreparationAuditEnvelope({
    normalizedAudit,
    dependencyEvidence,
    auditRequired,
    now
  });
  for (const auditBlocker of collectPreparationAuditBlockers(normalizedAudit, auditRequired)) {
    blockers.push(auditBlocker);
  }

  const forbiddenDecisionsWriteScope = collectForbiddenDecisionsWriteScopePaths(writeScope);
  if (forbiddenDecisionsWriteScope.length > 0) {
    blockers.push({
      code: "decisions_write_scope_forbidden",
      reason: `write_scope must not include wiki/decisions or any path beneath it (accepted decision authority is human/operator-only): ${forbiddenDecisionsWriteScope.join(", ")}`
    });
  }

  if (!readOnly) {
    if (!Array.isArray(subject?.write_scope) || subject.write_scope.length === 0) {
      blockers.push({
        code: "missing_write_scope",
        reason: "write_scope is required for dispatch readiness"
      });
    } else if ((policy.invalid_paths || []).length > 0) {
      blockers.push({
        code: "invalid_write_scope",
        reason: policy.invalid_paths
          .map((entry) => `${entry.input_path}: ${entry.reason}`)
          .join("; ")
      });
    }
  }

  const requiresGraphImpact = Boolean(subject?.dispatch_intent?.requires_graph_impact);
  const structuredGraphImpactMatches = graphImpact
    ? graphImpactMatchesSubject(graphImpact, subject, unit)
    : false;

  const effectiveGraphState = normalizeDispatchGraphState(
    structuredGraphImpactMatches ? graphImpact.graph_state : graphState
  );
  const clusteringGraphState = liveGraphState
    ? normalizeDispatchGraphState(liveGraphState)
    : effectiveGraphState;

  const effectiveGraphStateHasUnavailableSubjectPaths = graphStateHasUnavailableSubjectPath(
    effectiveGraphState,
    graphBearingSubjectPaths
  );
  const graphImpactDisposition = evaluateGraphImpactBlocker(effectiveGraphState);
  const graphImpactOperatorBlocked = graphImpactDisposition?.blocking === true;
  const dirtyOverlayDegradedGraphImpact =
    structuredGraphImpactMatches &&
    isDirtyOverlayCompatibleGraphState(effectiveGraphState) &&
    ["stale", "missing", "rebuild_required", "unknown"].includes(
      effectiveGraphState.staleness
    );

  const graphImpactEvidenceConsumable =
    structuredGraphImpactMatches &&
    effectiveGraphState.graph_available === true &&
    !graphImpactOperatorBlocked &&
    !effectiveGraphStateHasUnavailableSubjectPaths &&
    (dirtyOverlayDegradedGraphImpact ||
      !["stale", "rebuild_required", "missing"].includes(effectiveGraphState.staleness));

  const graphAutoRecoverable =
    requiresGraphImpact &&
    !structuredGraphImpactMatches &&
    graphBearingSubjectPaths.length > 0 &&
    effectiveGraphState.graph_available === true &&
    effectiveGraphState.staleness === "stale" &&
    isDirtyOverlayCompatibleGraphState(effectiveGraphState) &&
    !effectiveGraphStateHasUnavailableSubjectPaths;

  const storedEvidenceFresh =
    structuredGraphImpactMatches &&
    !graphImpactOperatorBlocked &&
    (dirtyOverlayDegradedGraphImpact ||
      !["stale", "rebuild_required", "missing", "unknown"].includes(
        effectiveGraphState.staleness
      ));
  const effectiveStateFresh =
    effectiveGraphState.staleness === "fresh" &&
    effectiveGraphState.graph_available === true &&
    !graphImpactOperatorBlocked &&
    !effectiveGraphStateHasUnavailableSubjectPaths;
  const graphRecovery = !requiresGraphImpact
    ? "not_required"
    : storedEvidenceFresh || effectiveStateFresh
      ? "fresh"
      : graphBearingSubjectPaths.length === 0 || effectiveGraphStateHasUnavailableSubjectPaths
        ? "nonrecoverable_missing_paths"
        : "recoverable_stale";
  if (
    requiresGraphImpact &&
    graphImpactSubjectPaths.length === 0
  ) {

    blockers.push({
      code: "missing_graph_impact",
      reason:
        "graph impact is required but no implementation or test subject paths are declared in write_scope or repo_paths"
    });
  } else if (
    requiresGraphImpact &&
    graphBearingSubjectPaths.length > 0 &&
    effectiveGraphStateHasUnavailableSubjectPaths
  ) {
    blockers.push({
      code: "missing_graph_impact",
      reason: "graph impact is required but selected subject paths are unavailable"
    });
  } else if (
    !readOnly &&
    requiresGraphImpact &&
    graphBearingSubjectPaths.length > 0 &&
    (graphImpactOperatorBlocked ||
      ((!structuredGraphImpactMatches || !dirtyOverlayDegradedGraphImpact) &&
        (effectiveGraphState.staleness === "stale" ||
          effectiveGraphState.staleness === "rebuild_required" ||
          effectiveGraphState.staleness === "missing")))
  ) {
    const unavailableOrErrored =
      effectiveGraphState.graph_available !== true ||
      effectiveGraphState.graph_state === "unavailable" ||
      effectiveGraphState.graph_state === "error" ||
      effectiveGraphState.graph_state === "query_error";
    blockers.push({
      code: unavailableOrErrored ? "missing_graph_impact" : "stale_write_scope",
      reason: unavailableOrErrored
        ? `graph impact is ${effectiveGraphState.graph_state ?? "unavailable"}`
        : `write-scope evidence is ${effectiveGraphState.staleness}`
    });
  }

  if (!readOnly) {
    const acceptanceValidation = Array.isArray(subject?.acceptance?.validation)
      ? subject.acceptance.validation
      : [];
    if (acceptanceValidation.length === 0) {
      blockers.push({
        code: "missing_validation",
        reason: "acceptance.validation must list at least one validation command"
      });
    }
  }

  let prospectiveReviewRemediationUnit = null;
  if (!readOnly && unit.kind === "slice" && selectedUnit && subject?.work_kind === "implementation") {
    const prospectiveReviewBlocker = collectProspectiveSliceReviewAcceptanceBlocker(
      record,
      selectedUnit,
      unit
    );
    if (prospectiveReviewBlocker) {
      blockers.push({
        code: prospectiveReviewBlocker.code,
        reason: prospectiveReviewBlocker.reason
      });
      prospectiveReviewRemediationUnit = prospectiveReviewBlocker.remediation_unit;
    }
  }

  if (!readOnly && subject?.work_kind === "tracker" && unit.kind === "work_item") {
    blockers.push({
      code: "tracker_not_dispatchable",
      reason: "tracker work items must be dispatched through a selected slice"
    });
  }

  if (unit.kind === "slice" && !selectedUnit) {
    blockers.push({
      code: "missing_slice",
      reason: `selected slice ${unit.slice_id} was not found on ${record.id}`
    });
  }

  if (
    unit.kind === "work_item" &&
    subject?.dispatch_intent?.target_unit === "slice" &&
    Array.isArray(record?.slices) &&
    record.slices.length > 0
  ) {
    blockers.push({
      code: "missing_slice",
      reason: `dispatch target ${record.id} requires a selected slice`
    });
  }

  if (!readOnly && subject?.work_kind !== "implementation") {
    blockers.push({
      code: "not_implementation",
      reason: `work_kind ${subject?.work_kind} is not implementation`
    });
  }

  if (isObject(record.migration) && !isMigrationReviewAcknowledged(record.migration)) {
    blockers.push({
      code: "migration_review_required",
      reason: "migrated work records require a trusted review acknowledgement before dispatch"
    });
  }

  if (
    subject?.dispatch_intent?.requires_graph_impact &&
    graphBearingSubjectPaths.length > 0 &&
    !effectiveGraphState.graph_available
  ) {
    blockers.push({
      code: "missing_graph_impact",
      reason: "graph impact is required but unavailable"
    });
  }

  if (
    (graphImpactUnbuildable || graphImpactFailure) &&
    (requiresGraphImpact || graphBearingImplementationWriteScope.length >= 2)
  ) {
    blockers.push({
      code: "missing_graph_impact",
      reason:
        "code graph could not be produced for write-scope clustering; build or fix the repo code index"
    });
  }

  const shimCollapsedPolicy = maybeCollapseShimClusters(policy, subject, clusteringGraphState);
  const effectivePolicy = maybeCollapseExtractionSpliceClusters(
    shimCollapsedPolicy,
    record,
    subject,
    unit,
    clusteringGraphState,
    graphImpact,
    null,
    now
  );

  if (!readOnly) {
    if ((effectivePolicy.cluster_count ?? 0) === 0) {
      blockers.push({
        code: "zero_clusters",
        reason: effectivePolicy.split_recommendation?.reason || "no valid cluster inputs"
      });
    }
  }

  const blastRadius = clone(effectivePolicy.blast_radius || {
    level: "low",
    reasons: [],
    accepted_escalation_id: null
  });
  let acceptedEscalationMatches = { validMatches: [], expiredMatches: [], scopeMismatches: [] };

  if (!readOnly) {
    acceptedEscalationMatches = collectAcceptedEscalations(
      record.id,
      unit.kind === "slice" ? unit.slice_id : null,
      writeScope,
      now,
      Array.isArray(record.escalations) ? record.escalations : []
    );

    if (blastRadius.level === "critical" && acceptedEscalationMatches.validMatches.length > 0) {
      const accepted = acceptedEscalationMatches.validMatches.sort((left, right) =>
        String(left.id).localeCompare(String(right.id))
      )[0];
      blastRadius.accepted_escalation_id = accepted.id;
    }
  }

  const decisionCode = chooseDecisionCode(blockers);
  const acceptedEscalations = decisionCode === "dispatchable_with_accepted_escalation"
    ? acceptedEscalationMatches.validMatches
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
        .map((escalation) =>
          compactAcceptedEscalation(record.id, unit.kind === "slice" ? unit.slice_id : null, escalation)
        )
    : [];

  const reasons = [
    ...new Set(
      blockers
        .filter((entry) => entry.code !== "dispatchable_with_accepted_escalation")
        .map((entry) => entry.reason)
        .filter(Boolean)
    )
  ];
  const dispatchable = decisionCode === "dispatchable" || decisionCode === "dispatchable_with_accepted_escalation";
  const validationHints = collectValidationHints({
    policy: effectivePolicy,
    parserDiagnostics,
    subject,
    unit,
    selectedUnit,
    reportOnly,
    decisionCode
  });
  const derivedEvidence = collectDerivedEvidence({
    graphState: effectiveGraphState,
    parserDiagnostics,
    policy: effectivePolicy,
    dependencyEvidence,
    preparationAuditEnvelope,
    missingSlice: unit.kind === "slice" && !selectedUnit ? unit.slice_id : null,
    reportOnly

  }).concat(
    collectGraphImpactEvidence(graphImpactEvidenceConsumable ? graphImpact : null)
  );

  const canonicalRefs = uniqueBy(
    [
      ...(effectivePolicy.canonical_refs || []),
      ...(structuredGraphImpactMatches && Array.isArray(graphImpact.summary?.canonical_refs)
        ? graphImpact.summary.canonical_refs.filter(isCanonicalGraphImpactRef)
        : [])
    ],
    (entry) => `${entry.id ?? ""}|${entry.path ?? ""}|${entry.source_kind ?? ""}`
  );

  const readiness = createReadinessEnvelope({
    recordId: record.id,
    unit,
    policy: {
      ...effectivePolicy,
      blast_radius: blastRadius
    },
    state: effectiveGraphState,
    reasons,
    decisionCode,
    dispatchable,
    acceptedEscalations,
    validationHints,
    derivedEvidence,
    canonicalRefs,
    dispatchRole: readOnly ? "read_only" : "implementation",
    graphAutoRecoverable,
    recovery: {
      graph_impact: graphRecovery,
      admission_metrics: admissionRecovery?.recovery?.admission_metrics,
      target_resolution: admissionRecovery?.recovery?.target_resolution
    }
  });

  const prospectiveNextCalls =
    prospectiveReviewRemediationUnit && decisionCode === "missing_validation"
      ? [
          buildNextCall({
            tool: "workspace_work_record_set_acceptance",
            arguments: { unit: prospectiveReviewRemediationUnit },
            recommended: true
          })
        ]
      : null;
  return {
    ...readiness,
    ...(graphImpactFailure ? { graph_impact_failure: graphImpactFailure } : {}),
    ...(prospectiveNextCalls ? { next_calls: prospectiveNextCalls } : {}),
    state: {
      ...readiness.state,
      graph_state: {
        ...readiness.state.graph_state,
        graph_state: effectiveGraphState.graph_state,
        overlay_state: effectiveGraphState.overlay_state
      }
    }
  };
}
