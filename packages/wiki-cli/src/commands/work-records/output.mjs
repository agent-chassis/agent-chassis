

export function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

export function formatRefreshResult(result, { recordId }) {
  const effectiveRecordId = result.record_id || recordId || "(missing)";
  const lines = [
    `Record: ${effectiveRecordId}`,
    `Source digest: ${result.source_digest || "(missing)"}`,
    `JSON written: ${Boolean(result.written)}`
  ];

  if (result.canonical_record_path) {
    lines.push(`Path: ${result.canonical_record_path}`);
  }

  if ("expected_source_digest" in result) {
    lines.push(`Expected source digest: ${result.expected_source_digest || "(missing)"}`);
    lines.push(`Current source digest: ${result.current_source_digest || "(missing)"}`);
  }

  for (const diagnostic of result.diagnostics || []) {
    lines.push(`- ${diagnostic.code}: ${diagnostic.message}`);
  }

  return lines.join("\n");
}

export function createPersistGraphImpactResult({
  command,
  recordId = null,
  unit = null,
  path = null,
  graphImpactJsonFile = null,
  sourceDigest = null,
  written = false,
  valid = false,
  diagnostics = [],
  graphImpact = null,
  derivedEvidence = null
}) {
  return {
    command,
    record_id: recordId,
    unit: unit
      ? {
          address: unit.address || null,
          record_id: unit.record_id || null,
          slice_id: unit.slice_id ?? null
        }
      : {
          address: null,
          record_id: null,
          slice_id: null
        },
    path,
    graph_impact_json_file: graphImpactJsonFile,
    source_digest: sourceDigest,
    written: Boolean(written),
    valid: Boolean(valid),
    diagnostics,
    graph_impact: graphImpact,
    derived_evidence: derivedEvidence
  };
}

export function formatPersistGraphImpactResult(result) {
  const effectiveRecordId = result.record_id || "(missing)";
  const effectiveUnitAddress = result.unit?.address || "(missing)";
  const lines = [
    `Record: ${effectiveRecordId}`,
    `Unit: ${effectiveUnitAddress}`,
    `Path: ${result.path || "(missing)"}`,
    `Graph-impact JSON file: ${result.graph_impact_json_file || "(missing)"}`,
    `Source digest: ${result.source_digest || "(missing)"}`,
    `Written: ${Boolean(result.written)}`,
    `Valid: ${Boolean(result.valid)}`
  ];

  for (const diagnostic of result.diagnostics || []) {
    lines.push(`- ${diagnostic.code}: ${diagnostic.message}`);
  }

  return lines.join("\n");
}

export function formatCleanupResult(result) {
  const report = result.report || {};
  const mode = report.mode || result.mode || (result.written ? "apply" : "plan");
  const lines = [
    `Record: ${result.record_id || "(missing)"}`,
    `Mode: ${mode}${mode === "plan" ? " (dry-run)" : ""}`,
    `Changed: ${Boolean(report.changed)}`,
    `Written: ${Boolean(result.written)}`,
    `Valid: ${Boolean(result.valid)}`
  ];
  if (report.changed === false && report.before) {
    lines.push("No-op: nothing to prune");
  }
  if (report.before && report.after) {
    lines.push(
      `Entries: ${report.before.total} -> ${report.after.total} ` +
        `(removed ${report.removed?.count ?? 0}, ~${report.removed?.approx_bytes_reclaimed ?? 0} bytes reclaimed)`
    );
  }
  if (report.diagnostics) {
    lines.push(
      `Deduped units: ${report.diagnostics.duplicate_unit_count ?? 0}; ` +
        `malformed kept: ${report.diagnostics.malformed_worker_admission_count ?? 0}; ` +
        `preserved non-admission: ${report.diagnostics.preserved_non_worker_admission_count ?? 0}`
    );
  }
  if (report.next_action) {
    lines.push(`Next: ${report.next_action}`);
  }
  if (result.expected_source_digest) {
    lines.push(`Expected source digest: ${result.expected_source_digest}`);
    lines.push(`Current source digest: ${result.current_source_digest || "(missing)"}`);
  }
  for (const diagnostic of result.diagnostics || []) {
    lines.push(`- ${diagnostic.code}: ${diagnostic.message}`);
  }
  return lines.join("\n");
}

export function formatCleanupAllResult(result) {
  const report = result.report || {};
  const mode = report.mode || (result.write ? "apply" : "plan");
  const lines = [
    `Scope: ${report.scope || (report.requested_record_ids ? "filtered" : "all")}`,
    `Mode: ${mode}${mode === "plan" ? " (dry-run)" : ""}`,
    ...(report.concurrency != null ? [`Concurrency: ${report.concurrency}`] : []),
    `Records scanned: ${report.records_scanned ?? 0}`,
    `Changed: ${report.records_changed ?? 0} (written ${report.records_written ?? 0}); ` +
      `no-op: ${report.records_no_op ?? 0}; refused: ${report.records_refused ?? 0}; ` +
      `skipped: ${report.records_skipped ?? 0}; write-failed: ${report.records_write_failed ?? 0}`,
    `Sidecars written: ${report.sidecars_written ?? 0}`,
    `Approx bytes reclaimed: ~${report.approx_bytes_reclaimed ?? 0}`
  ];
  for (const entry of report.per_record || []) {
    if (entry.status === "no_op") {
      continue;
    }
    const bytes =
      entry.before_approx_bytes != null && entry.after_approx_bytes != null
        ? ` ${entry.before_approx_bytes}->${entry.after_approx_bytes} bytes`
        : "";
    const counts =
      entry.before_evidence_count != null && entry.after_evidence_count != null
        ? ` ${entry.before_evidence_count}->${entry.after_evidence_count} entries`
        : "";
    const reason = entry.reason ? ` — ${entry.reason}` : "";
    lines.push(`- ${entry.record_id}: ${entry.status}${counts}${bytes}${reason}`);
  }
  for (const diagnostic of result.diagnostics || []) {
    lines.push(`- ${diagnostic.code}: ${diagnostic.message}`);
  }
  return lines.join("\n");
}
