

import { clone, isObject } from "./work-record-dispatch-shared.mjs";
import { collectValidationHints } from "./work-record-dispatch-validation-hints.mjs";
import { collectDerivedEvidence } from "./work-record-dispatch-evidence.mjs";

export const WORK_RECORD_DISPATCH_SCHEMA_VERSION = "dispatch-readiness.v1";

export const WORK_RECORD_DISPATCH_RECOVERY_STATE_VALUES = Object.freeze([
  "not_required",
  "fresh",
  "recoverable_missing",
  "recoverable_stale",
  "recoverable_outdated",
  "nonrecoverable_integrity_failure",
  "nonrecoverable_ambiguous",
  "nonrecoverable_missing_paths",
  "nonrecoverable_provider_unavailable",
  "nonrecoverable_malformed"
]);

const DEFAULT_GRAPH_STATE = Object.freeze({
  graph_available: false,
  edge_source: "unavailable",
  dirty_graph_mode: "unavailable",
  unavailable_paths: []
});

const DEFAULT_RECOVERY = Object.freeze({
  graph_impact: "not_required",
  admission_metrics: "not_required",
  target_resolution: "not_required"
});

const RECOVERY_AXES = Object.freeze([
  "graph_impact",
  "admission_metrics",
  "target_resolution"
]);

export const MANAGED_WK_ALLOCATION_READINESS_SCHEMA_VERSION =
  "managed-wk-allocation-readiness.v1";

function normalizeUnavailablePaths(paths) {
  return [...new Set(
    (Array.isArray(paths) ? paths : [])
      .filter((path) => typeof path === "string" && path.length > 0)
  )].sort((left, right) => left.localeCompare(right));
}

function validateReadinessRecovery(recovery) {
  if (!isObject(recovery)) {
    throw new TypeError("createReadinessEnvelope recovery must be an object");
  }
  for (const axis of RECOVERY_AXES) {
    if (!Object.hasOwn(recovery, axis)) {
      throw new TypeError(`createReadinessEnvelope recovery.${axis} is required`);
    }
    if (!WORK_RECORD_DISPATCH_RECOVERY_STATE_VALUES.includes(recovery[axis])) {
      throw new TypeError(
        `createReadinessEnvelope recovery.${axis} must be one of the declared recovery states`
      );
    }
  }
  return recovery;
}

export function createDefaultReadinessState(graphState) {
  const normalizedGraphState = isObject(graphState) ? graphState : {};
  const graphStateProjection = isObject(normalizedGraphState.graph_state)
    ? normalizedGraphState.graph_state
    : normalizedGraphState;
  const dirtyState = graphStateProjection.dirty_state ?? normalizedGraphState.dirty_state ?? "unknown";
  const staleness = graphStateProjection.staleness ?? normalizedGraphState.staleness ?? "unknown";
  const graphAvailable = Boolean(
    graphStateProjection.graph_available ?? normalizedGraphState.graph_available
  );
  return {
    dirty_state: dirtyState,
    staleness,
    graph_available: graphAvailable,
    graph_state: {
      dirty_state: graphStateProjection.dirty_state ?? dirtyState,
      staleness: graphStateProjection.staleness ?? staleness,
      graph_available: Boolean(graphStateProjection.graph_available ?? graphAvailable),
      edge_source: graphStateProjection.edge_source ?? DEFAULT_GRAPH_STATE.edge_source,
      dirty_graph_mode:
        graphStateProjection.dirty_graph_mode ?? DEFAULT_GRAPH_STATE.dirty_graph_mode,
      ...(graphStateProjection.graph_schema_version
        ? { graph_schema_version: graphStateProjection.graph_schema_version }
        : {}),
      unavailable_paths: normalizeUnavailablePaths(graphStateProjection.unavailable_paths)
    }
  };
}

function normalizeReadinessUnit(dispatchReadiness) {
  if (!isObject(dispatchReadiness?.unit)) {
    return {
      kind: "work_item",
      address: typeof dispatchReadiness?.record_id === "string" ? dispatchReadiness.record_id : "unknown",
      record_id: typeof dispatchReadiness?.record_id === "string" ? dispatchReadiness.record_id : null,
      slice_id: null
    };
  }
  const unit = dispatchReadiness.unit;
  const recordId =
    typeof unit.record_id === "string" && unit.record_id.length > 0
      ? unit.record_id
      : typeof dispatchReadiness.record_id === "string"
        ? dispatchReadiness.record_id
        : null;
  const sliceId = typeof unit.slice_id === "string" && unit.slice_id.length > 0 ? unit.slice_id : null;
  const address =
    typeof unit.address === "string" && unit.address.length > 0
      ? unit.address
      : sliceId && recordId
        ? `${recordId}#${sliceId}`
        : recordId ?? "unknown";
  return {
    kind: typeof unit.kind === "string" && unit.kind.length > 0 ? unit.kind : "work_item",
    address,
    record_id: recordId,
    slice_id: sliceId
  };
}

export function normalizeReadinessEnvelope(dispatchReadiness) {
  if (!isObject(dispatchReadiness)) {
    return {
      schema_version: WORK_RECORD_DISPATCH_SCHEMA_VERSION,
      record_id: null,
      unit: normalizeReadinessUnit(null),
      dispatch_role: "implementation",
      dispatchable: false,
      decision_code: "invalid_record",
      reasons: ["dispatch readiness input is required"],
      clusters: [],
      blast_radius: { level: "low", reasons: [], accepted_escalation_id: null },
      accepted_escalations: [],
      canonical_refs: [],
      derived_evidence: [],
      validation_hints: [],
      recovery: clone(DEFAULT_RECOVERY),
      state: createDefaultReadinessState(null)
    };
  }
  const policy = {
    clusters: Array.isArray(dispatchReadiness.clusters) ? dispatchReadiness.clusters : [],
    blast_radius: isObject(dispatchReadiness.blast_radius)
      ? dispatchReadiness.blast_radius
      : undefined
  };
  const normalized = {
    schema_version: WORK_RECORD_DISPATCH_SCHEMA_VERSION,
    record_id: dispatchReadiness.record_id ?? null,
    unit: normalizeReadinessUnit(dispatchReadiness),
    dispatch_role: dispatchReadiness.dispatch_role === "read_only" ? "read_only" : "implementation",
    dispatchable: dispatchReadiness.dispatchable === true,
    decision_code: dispatchReadiness.decision_code ?? "invalid_record",
    reasons: Array.isArray(dispatchReadiness.reasons) ? dispatchReadiness.reasons : [],
    clusters: policy.clusters,
    blast_radius: {
      level: policy.blast_radius?.level ?? "low",
      reasons: Array.isArray(policy.blast_radius?.reasons) ? policy.blast_radius.reasons : [],
      accepted_escalation_id: policy.blast_radius?.accepted_escalation_id ?? null
    },
    accepted_escalations: Array.isArray(dispatchReadiness.accepted_escalations)
      ? dispatchReadiness.accepted_escalations
      : [],
    canonical_refs: Array.isArray(dispatchReadiness.canonical_refs) ? dispatchReadiness.canonical_refs : [],
    derived_evidence: Array.isArray(dispatchReadiness.derived_evidence) ? dispatchReadiness.derived_evidence : [],
    validation_hints: Array.isArray(dispatchReadiness.validation_hints) ? dispatchReadiness.validation_hints : [],
    recovery: { ...DEFAULT_RECOVERY, ...(isObject(dispatchReadiness.recovery) ? dispatchReadiness.recovery : {}) },
    state: createDefaultReadinessState(dispatchReadiness.state)
  };
  normalized.state.graph_auto_recoverable = dispatchReadiness.state?.graph_auto_recoverable === true;
  return normalized;
}

export function createManagedWkAllocationReadiness({
  allocation,
  repository = null,
  role,
  subject,
  runId,
  monitorHandle
} = {}) {
  const generation = allocation?.controlled_contract_generation ?? null;
  const snapshot = allocation?.wk_snapshot;
  const binding = allocation?.wk_binding;
  if (allocation?.schema_version !== "managed-wk-lifecycle-allocation.v1" ||
      allocation.complete !== true || !Object.isFrozen(allocation) ||
      allocation.subject !== subject || allocation.run_id !== runId ||
      allocation.launch_ref !== monitorHandle || !Object.isFrozen(binding) ||
      !Object.isFrozen(snapshot) || binding.wk_tip_sha !== snapshot.tip ||
      snapshot.ref !== `refs/heads/${binding.output_branch}` ||
      (generation !== null && (!Object.isFrozen(generation) ||
        generation.schema_version !== "controlled-contract-resolved-generation.v1" ||
        generation.record_id !== allocation.record_id ||
        !/^sha256:[0-9a-f]{64}$/u.test(generation.generation_digest ?? "")))) {
    throw new TypeError("managed WK readiness allocation requires the exact WK-2261 owner result");
  }
  return Object.freeze({
    schema_version: MANAGED_WK_ALLOCATION_READINESS_SCHEMA_VERSION,
    owner: "WK-2261",
    complete: true,
    repository: typeof repository === "string" && repository.length > 0 ? repository : null,
    record_id: allocation.record_id,
    subject,
    role,
    initiative: allocation.initiative,
    run_id: runId,
    monitor_handle: monitorHandle,
    retry_id: allocation.retry_id,
    wk_ref: binding.output_branch,
    wk_tip: binding.wk_tip_sha,
    controlled_contract_generation: generation === null
      ? null
      : Object.freeze({
          schema_version: generation.schema_version,
          generation_digest: generation.generation_digest,
          carrier_count: generation.count
        }),
    wk_snapshot: Object.freeze({
      ref: snapshot.ref,
      tip: snapshot.tip,
      tree: snapshot.tree
    })
  });
}

export function projectLauncherTransitionReadiness(
  dispatchReadiness,
  launcherTransitionPlan,
  managedWkAllocation = null
) {
  if (!isObject(dispatchReadiness)) {
    throw new TypeError("launcher transition readiness requires a readiness envelope");
  }
  const lifecycle = launcherTransitionPlan?.lifecycle;
  const allocation = managedWkAllocation;
  if (!Object.isFrozen(launcherTransitionPlan) || lifecycle?.owner !== "WK-2261" ||
      !Object.isFrozen(lifecycle)) {
    throw new TypeError("launcher transition readiness requires the exact frozen transition plan");
  }
  const recordId = dispatchReadiness.record_id ?? dispatchReadiness.unit?.record_id ?? null;
  const projected = {
    decision_code: dispatchReadiness.decision_code ?? null,
    dispatchable: dispatchReadiness.dispatchable === true,
    record_id: recordId,
    unit: dispatchReadiness.unit ?? null,
    launcher_transition_plan: launcherTransitionPlan
  };
  if (allocation === null) return Object.freeze(projected);
  if (launcherTransitionPlan.phase !== "allocated" || !isObject(allocation) ||
      allocation.schema_version !== MANAGED_WK_ALLOCATION_READINESS_SCHEMA_VERSION ||
      allocation.owner !== "WK-2261" || allocation.complete !== true ||
      !Object.isFrozen(allocation)) {
    throw new TypeError(
      "managed WK allocation readiness requires the exact frozen WK-2261 allocation result"
    );
  }
  const subject = launcherTransitionPlan.role_runtime?.subject ?? null;
  if (typeof recordId !== "string" || allocation.record_id !== recordId ||
      typeof subject !== "string" || allocation.subject !== subject ||
      allocation.role !== launcherTransitionPlan.role_runtime?.role) {
    throw new TypeError("managed WK allocation readiness identity is mismatched");
  }
  return Object.freeze({ ...projected, managed_wk_allocation: allocation });
}

export function createSelectedUnitReadiness({ recordId, unit } = {}) {
  return createReadinessEnvelope({
    recordId: recordId ?? null,
    unit: unit ?? null,
    policy: { clusters: [{
      cluster_id: "selected_unit",
      input_paths: [], affected_surfaces: [], likely_tests: [], docs_contracts: [],
      canonical_refs: [], derived_evidence: [], confidence: "high",
      split_recommendation: { required: false, reason: "selected unit materializes as a single cluster" }
    }], blast_radius: { level: "low", reasons: [], accepted_escalation_id: null } },
    state: { graph_available: false, dirty_state: "clean", staleness: "fresh" },
    reasons: [], decisionCode: "dispatchable", dispatchable: true,
    acceptedEscalations: [], canonicalRefs: [], derivedEvidence: [], validationHints: [],
    recovery: DEFAULT_RECOVERY
  });
}

export function createReadinessEnvelope({
  recordId,
  unit,
  policy,
  state,
  reasons,
  decisionCode,
  dispatchable,
  acceptedEscalations,
  validationHints,
  derivedEvidence,
  canonicalRefs,
  dispatchRole = "implementation",
  recovery,

  graphAutoRecoverable = false
}) {
  const validatedRecovery = validateReadinessRecovery(recovery);
  return {
    schema_version: WORK_RECORD_DISPATCH_SCHEMA_VERSION,
    record_id: recordId,
    unit,
    dispatch_role: dispatchRole === "read_only" ? "read_only" : "implementation",
    dispatchable,
    decision_code: decisionCode,
    reasons,
    clusters: clone(policy?.clusters || []),
    blast_radius: clone(
      policy?.blast_radius || {
        level: "low",
        reasons: [],
        accepted_escalation_id: null
      }
    ),
    accepted_escalations: clone(acceptedEscalations || []),
    canonical_refs: clone(canonicalRefs || []),
    derived_evidence: clone(derivedEvidence || []),
    validation_hints: clone(validationHints || []),
    recovery: {
      graph_impact: validatedRecovery.graph_impact,
      admission_metrics: validatedRecovery.admission_metrics,
      target_resolution: validatedRecovery.target_resolution
    },
    state: {
      ...createDefaultReadinessState(state),
      graph_auto_recoverable: graphAutoRecoverable === true
    }
  };
}

export function compactAcceptedEscalation(recordId, sliceId, escalation) {
  return {
    id: escalation.id,
    kind: escalation.kind,
    status: escalation.status,
    matched_scope: {
      unit: recordId,
      slice_id: sliceId
    },
    authority_ref: escalation.authority_ref,
    accepted_by: {
      actor: escalation.accepted_by.actor,
      source: escalation.accepted_by.source
    },
    accepted_at: escalation.accepted_at,
    expires_at: escalation.expires_at ?? null
  };
}

export function buildTerminalReadiness({
  recordId,
  unit,
  state,
  decisionCode,
  reason,
  parserDiagnostics = [],
  reportOnly = false,
  dispatchRole = "implementation"
}) {
  return createReadinessEnvelope({
    recordId,
    unit,
    policy: {
      clusters: [],
      blast_radius: {
        level: "low",
        reasons: [],
        accepted_escalation_id: null
      }
    },
    state,
    reasons: [reason],
    decisionCode,
    dispatchable: false,
    acceptedEscalations: [],
    validationHints: collectValidationHints({
      policy: null,
      parserDiagnostics,
      subject: null,
      unit,
      selectedUnit: null,
      reportOnly,
      decisionCode
    }),
    derivedEvidence: collectDerivedEvidence({
      graphState: state,
      parserDiagnostics,
      policy: null,
      dependencyEvidence: [],
      preparationAuditEnvelope: null,
      missingSlice: null,
      reportOnly
    }),
    canonicalRefs: [],
    dispatchRole,
    recovery: {
      graph_impact: "not_required",
      admission_metrics: "not_required",
      target_resolution: "not_required"
    }
  });
}
