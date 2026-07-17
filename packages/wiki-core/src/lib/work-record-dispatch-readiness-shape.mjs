

import { clone } from "./work-record-dispatch-shared.mjs";
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

const DEFAULT_RECOVERY = Object.freeze({
  graph_impact: "not_required",
  admission_metrics: "nonrecoverable_malformed",
  target_resolution: "nonrecoverable_malformed"
});

export function createDefaultReadinessState(graphState) {
  return {
    dirty_state: graphState.dirty_state,
    staleness: graphState.staleness,
    graph_available: graphState.graph_available,
    graph_state: {
      dirty_state: graphState.dirty_state,
      staleness: graphState.staleness,
      graph_available: graphState.graph_available,
      edge_source: graphState.edge_source,
      dirty_graph_mode: graphState.dirty_graph_mode,
      graph_schema_version: graphState.graph_schema_version,
      unavailable_paths: clone(graphState.unavailable_paths || [])
    }
  };
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
  recovery = DEFAULT_RECOVERY,

  graphAutoRecoverable = false
}) {
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
      graph_impact: WORK_RECORD_DISPATCH_RECOVERY_STATE_VALUES.includes(recovery?.graph_impact)
        ? recovery.graph_impact
        : DEFAULT_RECOVERY.graph_impact,
      admission_metrics: WORK_RECORD_DISPATCH_RECOVERY_STATE_VALUES.includes(recovery?.admission_metrics)
        ? recovery.admission_metrics
        : DEFAULT_RECOVERY.admission_metrics,
      target_resolution: WORK_RECORD_DISPATCH_RECOVERY_STATE_VALUES.includes(recovery?.target_resolution)
        ? recovery.target_resolution
        : DEFAULT_RECOVERY.target_resolution
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
    dispatchRole
  });
}
