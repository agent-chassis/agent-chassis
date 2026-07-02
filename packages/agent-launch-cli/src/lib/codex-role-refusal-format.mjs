

import { isNonEmptyStringInternal } from "./codex-role-io.mjs";

export function formatRefusal(refusal) {
  const workerAdmission = refusal.worker_admission;
  const lines = [
    `wrapper_gate_code: ${refusal.wrapper_gate_code}`,
    `allowed: ${refusal.allowed}`,
    `unit_address: ${refusal.unit_address}`,
    `expected_unit_address: ${refusal.expected_unit_address}`,
    `decision_code: ${refusal.readiness?.decision_code ?? "(missing)"}`,
    `reasons: ${Array.isArray(refusal.readiness?.reasons) && refusal.readiness.reasons.length > 0 ? refusal.readiness.reasons.join("; ") : "(none)"}`,
    `validation_hints: ${Array.isArray(refusal.readiness?.validation_hints) && refusal.readiness.validation_hints.length > 0 ? refusal.readiness.validation_hints.join("; ") : "(none)"}`,
    `canonical_refs: ${Array.isArray(refusal.readiness?.canonical_refs) && refusal.readiness.canonical_refs.length > 0 ? refusal.readiness.canonical_refs.map((entry) => entry.path || entry.id || "(missing)").join("; ") : "(none)"}`
  ];
  if (workerAdmission && typeof workerAdmission === "object") {
    if (typeof workerAdmission.decision === "string") {
      lines.push(`worker_admission_decision: ${workerAdmission.decision}`);
      lines.push(`worker_admission_decision_code: ${workerAdmission.decision_code ?? "(missing)"}`);
      lines.push(`worker_admission_effect: ${workerAdmission.effect ?? "(missing)"}`);
    }
    if (typeof workerAdmission.code === "string") {
      lines.push(`worker_admission_refusal_code: ${workerAdmission.code}`);
      lines.push(`worker_admission_refusal_message: ${workerAdmission.message ?? "(missing)"}`);
    }

    const refreshRoute = isNonEmptyStringInternal(workerAdmission.refresh_route)
      ? workerAdmission.refresh_route
      : (isNonEmptyStringInternal(workerAdmission.refresh_command)
          && !/\s/.test(workerAdmission.refresh_command))
        ? workerAdmission.refresh_command
        : null;
    if (refreshRoute) {
      lines.push(`worker_admission_refresh_route: ${refreshRoute}`);
    }

    const admissionDetails = workerAdmission.details;
    const operatorFallbackCommand = admissionDetails
      && typeof admissionDetails === "object"
      && admissionDetails.human_operator_fallback
      && typeof admissionDetails.human_operator_fallback === "object"
      && isNonEmptyStringInternal(admissionDetails.human_operator_fallback.refresh_command)
      ? admissionDetails.human_operator_fallback.refresh_command
      : null;
    if (operatorFallbackCommand) {
      lines.push(
        `worker_admission_refresh_command_human_operator_fallback_only: ${operatorFallbackCommand}`
      );
    }
  }

  const remoteWorkerAdmission = refusal.remote_worker_admission;
  if (remoteWorkerAdmission && typeof remoteWorkerAdmission === "object") {
    lines.push(`node_engine_admissibility_code: ${remoteWorkerAdmission.remote_gate_code ?? "(missing)"}`);
    lines.push(`node_engine_admissibility_engaged: ${remoteWorkerAdmission.engaged === true}`);
    const detail = remoteWorkerAdmission.detail && typeof remoteWorkerAdmission.detail === "object"
      ? remoteWorkerAdmission.detail
      : null;
    if (detail) {
      lines.push(`node_engine_admissibility_effect: ${detail.remote_effect ?? "(none)"}`);
      lines.push(`node_engine_admissibility_disposition: ${detail.remote_disposition ?? "(none)"}`);
      lines.push(`node_engine_admissibility_outcome: ${detail.remote_outcome ?? "(none)"}`);
      lines.push(`node_engine_binding_status: ${detail.node_engine_binding_status ?? "(none)"}`);
      lines.push(`node_engine_binding_ratified: ${detail.ratified === true}`);
    }
  }
  const dependencyEvidence = refusal.dependency_evidence;
  if (dependencyEvidence && typeof dependencyEvidence === "object") {
    const summary = dependencyEvidence.provenance_summary || {};
    lines.push(`dependency_evidence_count: ${summary.count ?? 0}`);
    lines.push(
      `dependency_provenance: canonical_wk_json=${summary.canonical_wk_json ?? 0}, supplied=${summary.supplied ?? 0}, none=${summary.none ?? 0}, other=${summary.other ?? 0}`
    );
    const entries = Array.isArray(dependencyEvidence.entries) ? dependencyEvidence.entries : [];
    if (entries.length > 0) {
      const formatted = entries.map((entry) => {
        const address = entry?.address ?? "(missing)";
        const marker = entry?.marker ?? "(missing)";
        const provenance = entry?.provenance ?? "(missing)";
        const status = entry?.selected_status ?? "(none)";
        return `${address} marker=${marker} provenance=${provenance} status=${status}`;
      });
      lines.push(`dependency_entries: ${formatted.join("; ")}`);
    }
    const audit = dependencyEvidence.preparation_audit;
    if (audit && audit.preparation) {
      const prep = audit.preparation;
      lines.push(
        `preparation_audit: freshness_state=${prep.freshness_state ?? "(missing)"} audit_supplied=${prep.audit_supplied === true} audit_required=${prep.audit_required === true}`
      );
    } else {
      lines.push("preparation_audit: (absent)");
    }
  }
  for (const diagnostic of Array.isArray(refusal.diagnostics) ? refusal.diagnostics : []) {
    if (diagnostic?.message) {
      lines.push(`- ${diagnostic.message}`);
    }
  }
  return lines.join("\n");
}
