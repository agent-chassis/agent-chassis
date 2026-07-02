

import { clone, isNonEmptyString, isObject } from "./work-record-dispatch-shared.mjs";
import { buildPreparationAuditEvidenceEntry } from "./work-record-dispatch-preparation-audit.mjs";

export function collectDerivedEvidence({
  graphState,
  parserDiagnostics,
  policy,
  dependencyEvidence,
  preparationAuditEnvelope,
  missingSlice,
  reportOnly
}) {
  const evidence = [
    {
      kind: "dispatch_readiness_state",
      source_kind: "code_index",
      canonicality: "derived",
      evidence_basis: "git_tree",
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
    }
  ];

  if (Array.isArray(parserDiagnostics) && parserDiagnostics.length > 0) {
    evidence.push({
      kind: "dispatch_readiness_parser_diagnostics",
      source_kind: "parser_symbol",
      canonicality: "derived",
      evidence_basis: "parser_extract",
      diagnostics: parserDiagnostics.map((entry) => ({
        code: entry.code,
        path: entry.path ?? null,
        severity: entry.severity ?? "error"
      }))
    });
  }

  if (policy) {
    evidence.push({
      kind: "dispatch_readiness_policy",
      source_kind: "code_index",
      canonicality: "derived",
      evidence_basis: "path_match",
      cluster_count: policy.cluster_count ?? policy.clusters?.length ?? 0,
      split_recommendation: clone(policy.split_recommendation || null),
      blast_radius: clone(policy.blast_radius || null)
    });
  }

  if (Array.isArray(dependencyEvidence) && dependencyEvidence.length > 0) {
    evidence.push({
      kind: "dispatch_readiness_dependencies",
      source_kind: "issue",
      canonicality: "derived",
      evidence_basis: "explicit_metadata",
      pack_binding: "worker_admission_v1",
      operation_binding: "evaluate_work_unit_dispatch.v1",
      dependencies: dependencyEvidence.map((entry) => ({
        address: entry.address,
        source: entry.source,
        record_id: entry.record_id,
        slice_id: entry.slice_id,
        external_repo: entry.external_repo,
        selected_status: entry.selected_status,
        marker: entry.marker,
        provenance: entry.provenance,
        reason: entry.reason
      }))
    });
  }

  if (isObject(preparationAuditEnvelope)) {
    evidence.push(buildPreparationAuditEvidenceEntry(preparationAuditEnvelope));
  }

  if (missingSlice) {
    evidence.push({
      kind: "dispatch_readiness_missing_slice",
      source_kind: "issue",
      canonicality: "derived",
      evidence_basis: "explicit_metadata",
      slice_id: missingSlice
    });
  }

  if (reportOnly) {
    evidence.push({
      kind: "dispatch_readiness_report_mode",
      source_kind: "issue",
      canonicality: "derived",
      evidence_basis: "explicit_metadata",
      report_only: true
    });
  }

  return evidence;
}

export function collectGraphImpactEvidence(graphImpact) {
  if (!isObject(graphImpact)) {
    return [];
  }

  return [
    {
      kind: "dispatch_readiness_graph_impact",
      source_kind: "code_index",
      canonicality: "derived",
      evidence_basis: "path_match",
      query_kind: isNonEmptyString(graphImpact.query_kind) ? graphImpact.query_kind : null,
      input_paths: clone(graphImpact.input_paths || []),
      validated_paths: clone(graphImpact.validated_paths || []),
      invalid_paths: clone(graphImpact.invalid_paths || []),
      graph_state: {
        dirty_state: graphImpact.graph_state.dirty_state,
        staleness: graphImpact.graph_state.staleness,
        graph_available: graphImpact.graph_state.graph_available,
        edge_source: graphImpact.graph_state.edge_source,
        dirty_graph_mode: graphImpact.graph_state.dirty_graph_mode,
        graph_schema_version: graphImpact.graph_state.graph_schema_version,
        unavailable_paths: clone(graphImpact.graph_state.unavailable_paths || [])
      },
      summary: clone(graphImpact.summary || null)
    }
  ];
}
