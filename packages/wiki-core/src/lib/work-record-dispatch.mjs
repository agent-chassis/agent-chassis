

import path from "node:path";
import { types as utilTypes } from "node:util";

import {
  CLIENT_DISPOSITIONS,
  classifyConfigReadiness,
  resolveClientConfig
} from "./node-engine-api-client.mjs";
import { getSidecarIndexStatus } from "./sidecar-status.mjs";
import { SLICE_ID_PATTERN } from "./work-record-schema-constants.mjs";
import { evaluateWorkRecordPolicy } from "./work-record-policy.mjs";
import { isMigrationReviewAcknowledged } from "./work-record-schema.mjs";
import {
  deriveDirectImportAdjacencyFromGraph,
  resolveCurrentGraphForImpact
} from "./sidecar-graph-impact.mjs";
import { SidecarGraphIndexUnbuildableError } from "./sidecar-graph-impact-artifact.mjs";
import {
  foldNodeEngineAdmissibilityIntoReadiness,
  interpretNodeEngineAdmissibility,
  resolveNodeEngineAdmissibility
} from "./work-record-dispatch-node-engine-admissibility.mjs";

import {
  clone,
  isBashWrapperPath,
  isNonEmptyString,
  isObject,
  stringifyPathList,
  uniqueBy
} from "./work-record-dispatch-shared.mjs";
import {
  WORK_RECORD_DISPATCH_DECISION_CODES,
  chooseDecisionCode
} from "./work-record-dispatch-decision.mjs";
import {
  collectGraphImpactSubjectPaths,
  graphImpactMatchesSubject,
  graphStateHasUnavailableSubjectPath,
  isCanonicalGraphImpactRef,
  isDirtyOverlayCompatibleGraphState,
  normalizeGraphImpactEvidence,
  normalizeGraphState,
  resolveStoredGraphImpactEvidence
} from "./work-record-dispatch-graph.mjs";
import {
  collectDependencyBlockers,
  loadAdditionalDependencyRecords,
  normalizeDependencyStatuses,
  resolveDependencyEvidenceVector
} from "./work-record-dispatch-dependencies.mjs";
import {
  LOCAL_PREFLIGHT_NON_CLAIM_CONTRACT,
  PREPARATION_AUDIT_ENVELOPE_CONTRACT,
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
  WORK_RECORD_DISPATCH_SCHEMA_VERSION,
  buildTerminalReadiness,
  compactAcceptedEscalation,
  createReadinessEnvelope
} from "./work-record-dispatch-readiness-shape.mjs";
import {
  classifyWorkRecordAdmissionCompactRecovery,
  classifyWorkRecordAdmissionRecovery
} from "../operations/work-records-admission-evidence.mjs";
import {
  computeWorkRecordPersistenceSnapshotDigest
} from "../operations/work-records-store-io.mjs";
import {
  computeReviewedUnitSourceDigest,
  validateReviewAttestation
} from "./work-record-review-attestation.mjs";
import { evaluateGraphImpactBlocker } from "./runtime-blocker-taxonomy.mjs";
import { evaluateWorkRecordAdmissionDerivedEvidence } from "./work-record-admission.mjs";
import {
  readPersistedWorkerAdmissionEvidenceSidecarEntry
} from "./work-record-admission-evidence-sidecar.mjs";

export {
  WORK_RECORD_DISPATCH_SCHEMA_VERSION,
  WORK_RECORD_DISPATCH_RECOVERY_STATE_VALUES
} from "./work-record-dispatch-readiness-shape.mjs";
export { isBashWrapperPath } from "./work-record-dispatch-shared.mjs";
export {
  WORK_RECORD_DISPATCH_DECISION_CODES
} from "./work-record-dispatch-decision.mjs";
export {
  LOCAL_PREFLIGHT_NON_CLAIM_CONTRACT,
  PREPARATION_AUDIT_ENVELOPE_CONTRACT
} from "./work-record-dispatch-preparation-audit.mjs";

export {
  NODE_ENGINE_ADMISSIBILITY_DENIED_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_NEEDS_REVIEW_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNAVAILABLE_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNDETERMINED_DECISION_CODE,
  NODE_ENGINE_ADMISSIBILITY_UNRATIFIED_DECISION_CODE
} from "./work-record-dispatch-node-engine-admissibility.mjs";

export const WORK_RECORD_DISPATCH_UNIT_KIND_VALUES = Object.freeze([
  "work_item",
  "slice"
]);

const GRAPH_BEARING_CODE_EXTENSION_PATTERN = /\.(?:cjs|cts|js|jsx|mjs|mts|py|ts|tsx)$/;

const GRAPH_IMPACT_TAXONOMY_STATE_VALUES = new Set([
  "available",
  "unavailable",
  "error",
  "query_error"
]);

function normalizeDispatchGraphState(graphState = null) {
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

export function isGraphBearingCodePath(relativePath) {
  return (
    typeof relativePath === "string" &&
    GRAPH_BEARING_CODE_EXTENSION_PATTERN.test(relativePath)
  );
}

export function selectGraphBearingPaths(paths) {
  if (!Array.isArray(paths)) {
    return [];
  }
  return [...new Set(paths.filter(isGraphBearingCodePath))].sort((left, right) =>
    left.localeCompare(right)
  );
}

function isGraphBearingImplementationPath(relativePath) {
  return (
    isGraphBearingCodePath(relativePath) &&
    !String(relativePath).startsWith("tests/") &&
    !String(relativePath).includes(".test.")
  );
}

function selectGraphBearingImplementationPaths(paths) {
  if (!Array.isArray(paths)) {
    return [];
  }
  return [...new Set(paths.filter(isGraphBearingImplementationPath))].sort((left, right) =>
    left.localeCompare(right)
  );
}

export function deriveDirectImportAdjacency(mergedGraph, graphBearingPaths) {
  return deriveDirectImportAdjacencyFromGraph(mergedGraph, graphBearingPaths);
}

function normalizeSuppliedDirectImportAdjacency(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const pairs = [];
  for (const entry of value) {
    if (
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === "string" &&
      typeof entry[1] === "string"
    ) {
      pairs.push([entry[0], entry[1]]);
    }
  }
  return pairs;
}

function parseUnitAddress(unitAddress) {
  if (!isNonEmptyString(unitAddress)) {
    return {
      ok: false,
      value: null,
      diagnostics: [
        {
          code: "invalid_record",
          severity: "error",
          path: "unit",
          message: "unit address is required"
        }
      ]
    };
  }

  const pieces = String(unitAddress).split("#");
  if (pieces.length > 2 || !/^WK-[0-9]{4}$/.test(pieces[0])) {
    return {
      ok: false,
      value: null,
      diagnostics: [
        {
          code: "invalid_record",
          severity: "error",
          path: "unit",
          message: `Invalid dispatch unit address: ${unitAddress}`
        }
      ]
    };
  }

  if (pieces.length === 1) {
    return {
      ok: true,
      value: {
        kind: "work_item",
        address: pieces[0],
        record_id: pieces[0],
        slice_id: null
      },
      diagnostics: []
    };
  }

  const sliceId = pieces[1];
  if (!SLICE_ID_PATTERN.test(sliceId)) {
    return {
      ok: false,
      value: null,
      diagnostics: [
        {
          code: "invalid_record",
          severity: "error",
          path: "unit",
          message: `Invalid dispatch unit slice id: ${sliceId}`
        }
      ]
    };
  }

  return {
    ok: true,
    value: {
      kind: "slice",
      address: unitAddress,
      record_id: pieces[0],
      slice_id: sliceId
    },
    diagnostics: []
  };
}

function createSelectedSliceUnit(record, slice) {
  if (!isObject(slice)) {
    return null;
  }

  return {
    ...clone(slice),
    id: record.id,
    kind: "slice",
    slice_id: slice.id
  };
}

function maybeValidateSliceSelection(record, unit) {
  if (unit.kind !== "slice") {
    return { selectedUnit: null, missingSlice: null };
  }

  const slices = Array.isArray(record?.slices) ? record.slices : [];
  const selectedSlice = slices.find((entry) => entry && entry.id === unit.slice_id) || null;
  if (!selectedSlice) {
    return { selectedUnit: null, missingSlice: unit.slice_id };
  }

  return { selectedUnit: createSelectedSliceUnit(record, selectedSlice), missingSlice: null };
}

function resolveNodeEngineConfigReadiness(request) {
  const bundle = isObject(request) ? request : {};
  const config = isObject(bundle.config)
    ? bundle.config
    : resolveClientConfig(bundle.env ?? process.env);
  return classifyConfigReadiness(config);
}

function isConfirmedNoNodeEngineConfig(request, configReadiness) {
  if (isObject(request) && typeof request.resolver === "function") {
    return false;
  }
  return configReadiness?.disposition === CLIENT_DISPOSITIONS.LOCAL_ONLY_FAIL_OPEN;
}

function foldConfirmedNoNodeEngineIntoReadiness(readiness, configReadiness) {
  return {
    ...readiness,
    structural_readiness: {
      dispatchable: readiness.dispatchable === true,
      decision_code: readiness.decision_code
    },
    admissibility: {
      evaluated: true,
      authority: "local_only_config",
      status: CLIENT_DISPOSITIONS.LOCAL_ONLY_FAIL_OPEN,
      admissible: true,
      effect: CLIENT_DISPOSITIONS.LOCAL_ONLY_FAIL_OPEN,
      pack_backed: false,
      node_engine_backed: false,
      binding_status: null,
      ratified: false,
      diagnostic_code: configReadiness?.outcome ?? "node_engine_local_only_fail_open",
      reasons: [],
      authenticated_request_sent: false
    }
  };
}

const GRAPH_IMPACT_FAILURE_CODES = new Set([
  "graph_index_unbuildable",
  "graph_head_moved_unstable"
]);

function boundedGraphImpactFailure(error) {
  const code = GRAPH_IMPACT_FAILURE_CODES.has(error?.code)
    ? error.code
    : "graph_index_unbuildable";
  const statusReason =
    typeof error?.envelope?.status_reason === "string" &&
    /^[a-z0-9_]{1,80}$/.test(error.envelope.status_reason)
      ? error.envelope.status_reason
      : null;
  return {
    kind: "sidecar_graph_index_unbuildable",
    code,
    remediation:
      "build or fix the repo code index (run `code-index build` / `code-index rebuild`) before requesting graph impact",
    ...(statusReason ? { status_reason: statusReason } : {})
  };
}

function buildReadinessFromRecord({
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
  return {
    ...readiness,
    ...(graphImpactFailure ? { graph_impact_failure: graphImpactFailure } : {}),
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

async function resolveDispatchGraphState(dir, graphState) {
  if (graphState) {
    return {
      graphState: normalizeDispatchGraphState(graphState)
    };
  }

  const status = await getSidecarIndexStatus({ dir });
  return {
    graphState: normalizeDispatchGraphState({
      ...(isObject(status) ? status : {}),
      ...(isObject(status?.graph_state) ? status.graph_state : {})
    })
  };
}

const VALIDATE_WORK_RECORD_DISPATCH_OPTION_KEYS = new Set([
  "dir",
  "unitAddress",
  "mode",
  "dispatch_role",
  "recordStore",
  "graph_state",
  "graph_impact",
  "graph_import_adjacency",
  "dependency_statuses",
  "preparation_audit",
  "policy_result",
  "node_engine_admissibility",
  "graph_resolver",
  "suppress_live_graph_resolution",
  "now"
]);

const REVALIDATE_WORK_RECORD_DISPATCH_HANDOFF_OPTION_KEYS = new Set([
  "dir",
  "unitAddress",
  "recordStore",
  "private_handoff",
  "now"
]);

export class WorkRecordDispatchInvalidOptionError extends Error {
  constructor(callerName, optionNames, { message = null } = {}) {
    const sorted = [...optionNames].sort();
    super(message ?? `${callerName} does not accept option(s): ${sorted.join(", ")}`);
    this.name = "WorkRecordDispatchInvalidOptionError";
    this.code = "invalid_dispatch_option";
    this.options = sorted;
  }
}

export function sanitizeWorkRecordDispatchOptions(options, allowedKeys, callerName) {
  const source = options === undefined ? {} : options;
  const sourceType = typeof source;
  if (
    source === null ||
    (sourceType !== "object" && sourceType !== "function") ||
    utilTypes.isProxy(source)
  ) {
    throw new WorkRecordDispatchInvalidOptionError(callerName, ["<options>"]);
  }
  if (
    sourceType !== "object" ||
    Array.isArray(source) ||
    Object.getPrototypeOf(source) !== Object.prototype
  ) {
    throw new WorkRecordDispatchInvalidOptionError(callerName, ["<options>"]);
  }

  const allowed = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys);
  const descriptors = Object.getOwnPropertyDescriptors(source);
  const invalid = [];
  const sanitized = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string") {
      invalid.push("<symbol>");
      continue;
    }
    const descriptor = descriptors[key];
    if (!allowed.has(key) || !Object.prototype.hasOwnProperty.call(descriptor, "value")) {
      invalid.push(key);
      continue;
    }
    sanitized[key] = descriptor.value;
  }
  if (invalid.length > 0) {
    throw new WorkRecordDispatchInvalidOptionError(callerName, invalid);
  }
  return sanitized;
}

export function assertValidateWorkRecordDispatchOptions(options, callerName) {
  return sanitizeWorkRecordDispatchOptions(
    options,
    VALIDATE_WORK_RECORD_DISPATCH_OPTION_KEYS,
    callerName
  );
}

export async function validateWorkRecordDispatchById(options = {}) {
  const {
    dir = ".",
    unitAddress,
    mode = "strict",
    dispatch_role = "implementation",
    recordStore = null,
    graph_state = null,
    graph_impact = null,
    graph_import_adjacency = null,
    dependency_statuses = null,
    preparation_audit = null,
    policy_result = null,
    node_engine_admissibility = null,

    graph_resolver = null,

    suppress_live_graph_resolution = false,
    now = new Date().toISOString()
  } = assertValidateWorkRecordDispatchOptions(options, "validateWorkRecordDispatchById");
  const effectiveGraphResolver = graph_resolver ?? resolveCurrentGraphForImpact;
  const parsedUnit = parseUnitAddress(unitAddress);
  const reportOnly = mode === "report-only";
  const readOnly = dispatch_role === "read_only";

  if (!parsedUnit.ok) {
    const resolved = await resolveDispatchGraphState(dir, graph_state);
    return buildTerminalReadiness({
      recordId: null,
      unit: {
        kind: "work_item",
        address: unitAddress || "",
        record_id: null,
        slice_id: null
      },
      state: resolved.graphState,
      decisionCode: "invalid_record",
      reason: parsedUnit.diagnostics[0].message,
      parserDiagnostics: parsedUnit.diagnostics,
      reportOnly,
      dispatchRole: readOnly ? "read_only" : "implementation"
    });
  }

  const recordId = parsedUnit.value.record_id;
  const { loadWorkRecordById } = await import("./work-record-store.mjs");
  const loaded = await loadWorkRecordById({
    dir,
    id: recordId,
    recordStore
  });

  if (!loaded.valid) {
    const codes = loaded.diagnostics.map((entry) => entry.code);
    const terminalCode = codes.includes("missing_json_record")
      ? "missing_json_record"
      : codes.includes("unknown_schema_version")
        ? "unknown_schema_version"
        : codes.includes("unsupported_record_kind")
          ? "unsupported_record_kind"
          : "invalid_record";

    const reason = loaded.diagnostics.map((entry) => entry.message).join("; ");
    const resolved = await resolveDispatchGraphState(dir, graph_state);
    return buildTerminalReadiness({
      recordId,
      unit: parsedUnit.value,
      state: resolved.graphState,
      decisionCode: terminalCode,
      reason: reason || terminalCode,
      parserDiagnostics: loaded.diagnostics,
      reportOnly,
      dispatchRole: readOnly ? "read_only" : "implementation"
    });
  }

  const { selectedUnit, missingSlice } = maybeValidateSliceSelection(loaded.record, parsedUnit.value);

  const subject = selectedUnit || loaded.record;
  const subjectWriteScope = Array.isArray(subject?.write_scope) ? subject.write_scope : [];
  const subjectRepoPaths = Array.isArray(subject?.repo_paths) ? subject.repo_paths : [];
  const subjectGraphCandidatePaths = [...subjectWriteScope, ...subjectRepoPaths];
  const graphBearingWriteScope = selectGraphBearingPaths(subjectGraphCandidatePaths);
  const graphBearingImplementationWriteScope = selectGraphBearingImplementationPaths(subjectGraphCandidatePaths);

  const suppliedAdjacency =
    normalizeSuppliedDirectImportAdjacency(graph_import_adjacency) ??
    normalizeSuppliedDirectImportAdjacency(
      isObject(graph_impact) ? graph_impact.graph_import_adjacency : null
    );
  const callerSuppliedGraphEvidence =
    (graph_state !== null && graph_state !== undefined) ||
    (graph_impact !== null && graph_impact !== undefined);

  const suppressInitialLiveGraphResolution =
    suppress_live_graph_resolution === true &&
    Boolean(subject?.dispatch_intent?.requires_graph_impact);
  const requiresGraphImpact = Boolean(subject?.dispatch_intent?.requires_graph_impact);
  const shouldResolveLiveGraph =
    !readOnly &&
    !suppressInitialLiveGraphResolution &&
    subject?.work_kind === "implementation" &&
    (requiresGraphImpact || graphBearingImplementationWriteScope.length >= 2) &&
    suppliedAdjacency === null &&
    !callerSuppliedGraphEvidence;

  let directImportAdjacency = suppliedAdjacency ?? (
    graphBearingImplementationWriteScope.length <= 1 ? [] : null
  );
  let graphImpactUnbuildable = false;
  let graphImpactFailure = null;
  let liveGraphState = null;
  let resolvedGraphState = null;

  if (suppliedAdjacency !== null || !shouldResolveLiveGraph) {

    resolvedGraphState = (await resolveDispatchGraphState(dir, graph_state)).graphState;
  } else if (recordStore !== null) {

    graphImpactUnbuildable = true;
    resolvedGraphState = (await resolveDispatchGraphState(dir, graph_state)).graphState;
  } else {
    try {
      const live = await effectiveGraphResolver({ targetDir: path.resolve(String(dir ?? ".")) });
      const selection = live?.graphSelection;
      if (selection?.graphState?.graph_available === true && isObject(selection.graph)) {
        directImportAdjacency = deriveDirectImportAdjacency(
          selection.graph,
          graphBearingWriteScope
        );
        liveGraphState = selection.graphState;
      } else {
        graphImpactUnbuildable = true;
      }

      resolvedGraphState = normalizeDispatchGraphState({
        ...(isObject(live?.status) ? live.status : {}),
        ...(isObject(live?.status?.graph_state) ? live.status.graph_state : {})
      });
    } catch (error) {
      if (error instanceof SidecarGraphIndexUnbuildableError) {
        graphImpactFailure = boundedGraphImpactFailure(error);
        resolvedGraphState = normalizeDispatchGraphState({
          graph_available: false,
          graph_state: "unavailable",
          overlay_state: "unavailable",
          staleness: "rebuild_required",
          status_reason: graphImpactFailure.code,
          edge_source: "unavailable",
          dirty_graph_mode: "unavailable"
        });
      } else {
        throw error;
      }
    }
  }

  const dependencyStatuses = normalizeDependencyStatuses(dependency_statuses);
  const additionalDependencyRecords = await loadAdditionalDependencyRecords({
    record: loaded.record,
    selectedUnit,
    dir,
    recordStore
  });
  const graphImpactProvided = graph_impact !== null && graph_impact !== undefined;
  const storedGraphImpact = graphImpactProvided
    ? { graphImpact: null, present: false }
    : resolveStoredGraphImpactEvidence(
        loaded.record,
        selectedUnit || loaded.record,
        parsedUnit.value,
        loaded.source_digest ?? null
      );
  const suppliedGraphImpact = graphImpactProvided ? normalizeGraphImpactEvidence(graph_impact) : null;
  if (suppliedGraphImpact) {
    suppliedGraphImpact.graph_state = normalizeDispatchGraphState(
      isObject(graph_impact?.graph_state) ? graph_impact.graph_state : graph_impact
    );
  }
  const admissionRecovery = await classifyWorkRecordAdmissionRecovery({
    dir,
    record: loaded.record,
    unit: parsedUnit.value
  });

  const readiness = buildReadinessFromRecord({
    record: loaded.record,
    unit: parsedUnit.value,
    selectedUnit,
    graphState: resolvedGraphState,
    graphImpact: suppliedGraphImpact || storedGraphImpact.graphImpact,
    parserDiagnostics: loaded.diagnostics,
    policyResult: policy_result,
    dependencyStatuses,
    additionalDependencyRecords,
    preparationAudit: preparation_audit,
    directImportAdjacency,
    graphBearingWriteScope,
    graphBearingImplementationWriteScope,
    graphImpactUnbuildable,
    graphImpactFailure,
    liveGraphState,
    admissionRecovery,
    now,
    reportOnly,
    readOnly
  });

  const structuralFloorPasses = readiness.dispatchable === true;
  if (readOnly || !node_engine_admissibility || !structuralFloorPasses) {
    return readiness;
  }

  const configReadiness = resolveNodeEngineConfigReadiness(node_engine_admissibility);
  if (isConfirmedNoNodeEngineConfig(node_engine_admissibility, configReadiness)) {
    return foldConfirmedNoNodeEngineIntoReadiness(readiness, configReadiness);
  }

  const packResult = await resolveNodeEngineAdmissibility({
    request: node_engine_admissibility,
    record: loaded.record,
    selectedUnit,
    unit: parsedUnit.value,
    dir,
    readiness
  });
  return foldNodeEngineAdmissibilityIntoReadiness(
    readiness,
    interpretNodeEngineAdmissibility(packResult)
  );
}

function reviewedUnitDigestForDispatch(record, unit) {
  return computeReviewedUnitSourceDigest(
    unit.kind === "slice"
      ? { record, selected_slice_id: unit.slice_id }
      : record
  );
}

async function loadPrivateDispatchSnapshot({ dir, unitAddress, recordStore = null }) {
  const parsedUnit = parseUnitAddress(unitAddress);
  if (!parsedUnit.ok) return null;
  const { loadWorkRecordById } = await import("./work-record-store.mjs");
  const loaded = await loadWorkRecordById({
    dir,
    id: parsedUnit.value.record_id,
    recordStore
  });
  if (!loaded.valid || !loaded.record) return null;
  return {
    loaded,
    unit: parsedUnit.value,
    authored_source_digest: loaded.source_digest,
    full_persistence_snapshot_digest: computeWorkRecordPersistenceSnapshotDigest(loaded.record),
    reviewed_unit_digest: reviewedUnitDigestForDispatch(loaded.record, parsedUnit.value)
  };
}

export async function validateWorkRecordDispatchLaunchIntentById(options = {}) {
  const sanitized = assertValidateWorkRecordDispatchOptions(
    options,
    "validateWorkRecordDispatchLaunchIntentById"
  );
  const readiness = await validateWorkRecordDispatchById({
    ...sanitized,
    node_engine_admissibility: null
  });
  if (!readiness.dispatchable) {
    return { readiness, private_handoff: null };
  }
  const snapshot = await loadPrivateDispatchSnapshot(sanitized);
  return {
    readiness,
    private_handoff: snapshot
      ? {
          authored_source_digest: snapshot.authored_source_digest,
          full_persistence_snapshot_digest: snapshot.full_persistence_snapshot_digest,
          reviewed_unit_digest: snapshot.reviewed_unit_digest
        }
      : null
  };
}

export async function revalidateWorkRecordDispatchPrivateHandoffById(options = {}) {
  const {
    dir = ".",
    unitAddress,
    recordStore = null,
    private_handoff,
    now = new Date().toISOString()
  } = sanitizeWorkRecordDispatchOptions(
    options,
    REVALIDATE_WORK_RECORD_DISPATCH_HANDOFF_OPTION_KEYS,
    "revalidateWorkRecordDispatchPrivateHandoffById"
  );
  if (!isObject(private_handoff)) {
    return { valid: false, reason: "canonical_carrier_revalidation_failed", issue: "private_handoff_missing" };
  }
  const current = await loadPrivateDispatchSnapshot({ dir, unitAddress, recordStore });
  if (!current) {
    return { valid: false, reason: "canonical_carrier_revalidation_failed", issue: "canonical_work_record_unavailable" };
  }
  if (current.authored_source_digest !== private_handoff.authored_source_digest) {
    return { valid: false, reason: "canonical_source_digest_changed", issue: "authored_source_digest_mismatch" };
  }
  if (
    current.full_persistence_snapshot_digest !==
    private_handoff.full_persistence_snapshot_digest
  ) {
    return { valid: false, reason: "canonical_carrier_revalidation_failed", issue: "persistence_snapshot_digest_mismatch" };
  }
  if (current.reviewed_unit_digest !== private_handoff.reviewed_unit_digest) {
    return { valid: false, reason: "canonical_carrier_revalidation_failed", issue: "reviewed_unit_digest_mismatch" };
  }

  const classified = classifyWorkRecordAdmissionCompactRecovery({
    record: current.loaded.record,
    unit: current.unit
  });
  if (classified.recovery.admission_metrics !== "fresh") {
    return {
      valid: false,
      reason: "canonical_carrier_revalidation_failed",
      issue: classified.issue?.code ?? classified.recovery.admission_metrics
    };
  }
  if (
    classified.recovery.target_resolution !== "fresh" &&
    classified.recovery.target_resolution !== "not_required"
  ) {
    return {
      valid: false,
      reason: "canonical_carrier_revalidation_failed",
      issue: classified.issue?.code ?? classified.recovery.target_resolution
    };
  }

  let evaluatedEvidence;
  try {
    evaluatedEvidence =
      (await readPersistedWorkerAdmissionEvidenceSidecarEntry({
        dir,
        entry: classified.entry
      })) ?? classified.entry;
    evaluateWorkRecordAdmissionDerivedEvidence(evaluatedEvidence);
  } catch (error) {
    return {
      valid: false,
      reason: "canonical_carrier_revalidation_failed",
      issue: error?.code ?? "malformed_worker_admission_derived_evidence"
    };
  }

  const attestations = evaluatedEvidence?.normalized_request?.evidence?.review_attestations;
  for (const attestation of Array.isArray(attestations) ? attestations : []) {
    const verdict = validateReviewAttestation(attestation, {
      repo: current.loaded.record.repo,
      unit_address: current.unit.address,
      source_digest: current.reviewed_unit_digest,
      required_role_class: attestation?.reviewer_role_class,
      required_controls: attestation?.reviewed_controls,
      admitting_run_id: "dispatch-prelaunch-revalidation",
      now
    });
    if (!verdict.valid) {
      return {
        valid: false,
        reason: "canonical_carrier_revalidation_failed",
        issue: verdict.decision_code ?? "review_attestation_invalid"
      };
    }
  }
  return { valid: true, reason: null, issue: null };
}

export async function validateWorkRecordDispatchReportById(options = {}) {
  const sanitized = assertValidateWorkRecordDispatchOptions(
    options,
    "validateWorkRecordDispatchReportById"
  );
  const readiness = await validateWorkRecordDispatchById({
    ...sanitized,
    mode: "report-only"
  });

  return {
    report_mode: true,
    readiness
  };
}

export async function validateWorkRecordDispatchReadOnlyById(options = {}) {
  const sanitized = assertValidateWorkRecordDispatchOptions(
    options,
    "validateWorkRecordDispatchReadOnlyById"
  );
  return validateWorkRecordDispatchById({
    ...sanitized,
    dispatch_role: "read_only"
  });
}
