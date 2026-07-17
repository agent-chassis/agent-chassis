

import {
  cloneJson,
  isObject,
  normalizeStringEntry
} from "./work-record-admission-shared.mjs";
import {
  createCompactWorkRecordAdmissionDerivedEvidence,
  isCompactWorkerAdmissionDerivedEvidence
} from "./work-record-admission-derived-evidence.mjs";
import { validateWorkerAdmissionDerivedEvidence } from "./work-record-schema-derived-evidence.mjs";
import { WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION } from "./work-record-admission-decision-codes.mjs";
import {
  buildCompactInlineGraphEvidenceRef,
  buildGraphEvidenceSidecarEntry,
  buildGraphEvidenceSidecarFromEntries,
  computeGraphEvidenceSidecarDigest,
  graphEvidenceSidecarPathForRecord
} from "./work-record-graph-evidence-sidecar.mjs";
import {
  prepareWorkRecordAdmissionDerivedEvidenceSidecar
} from "./work-record-admission-derived-evidence-persist.mjs";

export const WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_SCHEMA_VERSION =
  "work-record-derived-evidence-cleanup.v1";
export const WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_KIND =
  "work_record_derived_evidence_cleanup";

const WORKER_ADMISSION_STRING_FIELDS = [
  "schema_version",
  "record_id",
  "source_record_digest",
  "decision_kind",
  "generated_at"
];
const WORKER_ADMISSION_OBJECT_FIELDS = [
  "unit",
  "generator",
  "metric_summary",
  "provenance"
];
const WORKER_ADMISSION_REFRESH_INCOMPATIBLE_SIDECAR_CLASS =
  "worker_admission_refresh_incompatible_sidecar";

function approxJsonBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null) ?? "", "utf8");
  } catch {
    return 0;
  }
}

function normalizePersistedWorkerAdmissionMetricSummary(entry) {
  const compactMetricSummary = cloneJson(entry?.metric_summary);
  if (!isObject(compactMetricSummary)) {
    return compactMetricSummary;
  }

  delete compactMetricSummary.feature_vector;
  delete compactMetricSummary.target_resolution_evidence;

  if (isObject(compactMetricSummary.structural_target_metrics)) {
    const compactStructuralTargetMetrics = cloneJson(compactMetricSummary.structural_target_metrics);
    delete compactStructuralTargetMetrics.targets;
    delete compactStructuralTargetMetrics.metric_source_provenance;
    delete compactStructuralTargetMetrics.metricSourceProvenance;
    compactMetricSummary.structural_target_metrics = compactStructuralTargetMetrics;
  }

  return compactMetricSummary;
}

function isWorkerAdmissionEntry(entry) {
  return (
    isObject(entry) &&
    normalizeStringEntry(entry.schema_version) ===
      WORK_RECORD_ADMISSION_DERIVED_EVIDENCE_SCHEMA_VERSION
  );
}

function isCompactWorkerAdmissionEntryWithSidecar(entry) {
  return (
    isCompactWorkerAdmissionDerivedEvidence(entry) &&
    normalizeStringEntry(entry.sidecar_path) !== null &&
    normalizeStringEntry(entry.sidecar_digest) !== null
  );
}

function hasRefreshRejectedCompactAdmissionSummary(entry) {
  if (
    !isCompactWorkerAdmissionEntryWithSidecar(entry) ||
    !Object.prototype.hasOwnProperty.call(entry, "admission_summary")
  ) {
    return false;
  }
  return !isObject(entry.admission_summary) ||
    normalizeStringEntry(entry.admission_summary.result) === null;
}

function resolveUnitAddress(entry) {
  const unit = isObject(entry?.unit) ? entry.unit : null;
  const address = normalizeStringEntry(unit?.address);
  if (address) {
    return address;
  }
  const recordId = normalizeStringEntry(unit?.record_id) ?? normalizeStringEntry(entry?.record_id);
  if (!recordId) {
    return null;
  }
  const sliceId = normalizeStringEntry(unit?.slice_id);
  return sliceId ? `${recordId}#${sliceId}` : recordId;
}

function generatedAtMillis(entry) {
  const raw = normalizeStringEntry(entry?.generated_at);
  if (!raw) {
    return null;
  }
  const millis = Date.parse(raw);
  return Number.isFinite(millis) ? millis : null;
}

function isUsableWorkerAdmissionEntry(entry) {
  if (!isWorkerAdmissionEntry(entry)) {
    return false;
  }
  if (hasRefreshRejectedCompactAdmissionSummary(entry)) {
    return false;
  }
  for (const field of WORKER_ADMISSION_STRING_FIELDS) {
    if (!normalizeStringEntry(entry[field])) {
      return false;
    }
  }
  for (const field of WORKER_ADMISSION_OBJECT_FIELDS) {
    if (!isObject(entry[field])) {
      return false;
    }
  }
  return resolveUnitAddress(entry) !== null && generatedAtMillis(entry) !== null;
}

function entryClass(entry) {
  if (!isWorkerAdmissionEntry(entry)) {
    return "preserved";
  }
  if (hasRefreshRejectedCompactAdmissionSummary(entry)) {
    return WORKER_ADMISSION_REFRESH_INCOMPATIBLE_SIDECAR_CLASS;
  }
  return isUsableWorkerAdmissionEntry(entry) ? "worker_admission_usable" : "worker_admission_malformed";
}

function preservedClassLabel(entry) {
  if (!isObject(entry)) {
    return Array.isArray(entry) ? "array" : `non_object:${entry === null ? "null" : typeof entry}`;
  }
  return normalizeStringEntry(entry.schema_version) ?? "unknown";
}

function compactRetainedDescriptor(entry, index, sidecar = null) {
  if (isWorkerAdmissionEntry(entry)) {
    const descriptor = {
      index,
      class: entryClass(entry),
      address: resolveUnitAddress(entry),
      generated_at: normalizeStringEntry(entry.generated_at),
      source_record_digest: normalizeStringEntry(entry.source_record_digest)
    };
    const sidecarPath =
      normalizeStringEntry(entry.sidecar_path) ?? normalizeStringEntry(sidecar?.path);
    if (sidecarPath) {
      descriptor.sidecar_path = sidecarPath;
    }
    const sidecarDigest =
      normalizeStringEntry(entry.sidecar_digest) ?? normalizeStringEntry(sidecar?.digest);
    if (sidecarDigest) {
      descriptor.sidecar_digest = sidecarDigest;
    }
    return descriptor;
  }
  return {
    index,
    class: "preserved",
    schema_version: preservedClassLabel(entry)
  };
}

function buildCompactWorkerAdmissionCleanupCandidate(entry) {
  if (!isObject(entry)) {
    return null;
  }
  if (isCompactWorkerAdmissionDerivedEvidence(entry)) {
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(entry, "normalized_request")) {
    return null;
  }

  const sidecarPayload = cloneJson(entry);
  delete sidecarPayload.sidecar_path;
  delete sidecarPayload.sidecar_digest;
  delete sidecarPayload.admission_summary;

  const preparedSidecar = prepareWorkRecordAdmissionDerivedEvidenceSidecar(sidecarPayload);
  const sidecarPath = preparedSidecar.relativePath;
  const sidecarDigest = preparedSidecar.digest;
  const compactEntry = createCompactWorkRecordAdmissionDerivedEvidence(sidecarPayload, {
    sidecarPath,
    sidecarDigest
  });
  compactEntry.metric_summary = normalizePersistedWorkerAdmissionMetricSummary(compactEntry);
  delete compactEntry.target_resolution_evidence;

  const recordId = normalizeStringEntry(compactEntry.record_id);
  const expectedUnit = isObject(compactEntry.unit) ? compactEntry.unit : null;
  const sidecarDiagnostics = validateWorkerAdmissionDerivedEvidence(sidecarPayload, {
    path: "derived_evidence[0]",
    recordId,
    expectedUnit
  });
  const compactDiagnostics = validateWorkerAdmissionDerivedEvidence(compactEntry, {
    path: "derived_evidence[0]",
    recordId,
    expectedUnit
  });
  if (sidecarDiagnostics.length > 0 || compactDiagnostics.length > 0) {
    return null;
  }

  return {
    entry: compactEntry,
    sidecar: {
      path: sidecarPath,
      digest: sidecarDigest,
      entry: sidecarPayload
    },
    compacted: true
  };
}

function entryHasInlineGraphReplayDetail(entry) {
  if (!isObject(entry)) {
    return false;
  }
  if (isObject(entry.graph_impact_summary)) {
    return true;
  }
  if (isObject(entry.graph_impact_summary_ref) && isObject(entry.graph_impact_summary_ref.summary)) {
    return true;
  }
  if (isObject(entry.graph_impact) && isObject(entry.graph_impact.summary)) {
    return true;
  }
  return false;
}

function buildEntryGraphSidecarization(entry, sidecarPath) {
  if (!entryHasInlineGraphReplayDetail(entry)) {
    return null;
  }
  let sidecarEntry;
  try {
    sidecarEntry = buildGraphEvidenceSidecarEntry({
      unit: entry.unit,
      graph_impact: entry.graph_impact,
      graph_impact_summary: entry.graph_impact_summary,
      graph_impact_summary_ref: entry.graph_impact_summary_ref,
      source_record_digest: entry.source_record_digest,
      generated_at: entry.generated_at
    });
  } catch {

    return null;
  }

  const compactedBase = cloneJson(entry);
  if (isObject(compactedBase.graph_impact)) {

    compactedBase.graph_impact.summary = null;
  }
  delete compactedBase.graph_impact_summary;

  delete compactedBase.graph_impact_summary_ref;

  const isSlice = sidecarEntry.unit?.kind === "slice";
  return {
    sidecarEntry,
    compactedBase,
    sidecarPath,
    isRecordEntry: !isSlice,
    sliceKey: isSlice ? normalizeStringEntry(sidecarEntry.unit?.slice_id) : null,
    replayDetailAvailable: sidecarEntry.replay_detail_available === true
  };
}

function finalizeEntryGraphSidecarization(originalEntry, graphResult, sidecarDigest) {
  const inlineRef = buildCompactInlineGraphEvidenceRef(graphResult.sidecarEntry, {
    sidecarPath: graphResult.sidecarPath,
    sidecarDigest
  });
  const compactedEntry = cloneJson(graphResult.compactedBase);
  compactedEntry.graph_impact_summary_ref = inlineRef;

  const beforeBytes = approxJsonBytes(pickGraphFields(originalEntry));
  const afterBytes = approxJsonBytes(pickGraphFields(compactedEntry));
  return {
    compactedEntry,
    inlineRef,
    reclaimedBytes: Math.max(0, beforeBytes - afterBytes)
  };
}

function pickGraphFields(entry) {
  const picked = {};
  for (const field of ["graph_impact", "graph_impact_summary", "graph_impact_summary_ref"]) {
    if (isObject(entry) && Object.prototype.hasOwnProperty.call(entry, field)) {
      picked[field] = entry[field];
    }
  }
  return picked;
}

function computeGraphSidecarization(recordId, keptIndexedEntries) {
  const resolvedRecordId = normalizeStringEntry(recordId);
  const sidecarPath = resolvedRecordId ? graphEvidenceSidecarPathForRecord(resolvedRecordId) : null;
  if (!sidecarPath) {
    return { byIndex: new Map(), sidecar: null, path: null, digest: null, counts: emptyGraphCounts() };
  }

  const staged = [];
  for (const { index, entry } of keptIndexedEntries) {
    const graphResult = buildEntryGraphSidecarization(entry, sidecarPath);
    if (graphResult) {
      staged.push({ index, originalEntry: entry, graphResult });
    }
  }
  if (staged.length === 0) {
    return { byIndex: new Map(), sidecar: null, path: sidecarPath, digest: null, counts: emptyGraphCounts() };
  }

  const sliceEntries = staged.filter((item) => !item.graphResult.isRecordEntry).map((item) => item.graphResult.sidecarEntry);
  const recordEntryItem = staged.find((item) => item.graphResult.isRecordEntry) ?? null;
  const generatedAt = staged
    .map((item) => normalizeStringEntry(item.originalEntry.generated_at))
    .filter(Boolean)
    .sort()
    .pop() ?? null;

  let sidecar;
  try {
    sidecar = buildGraphEvidenceSidecarFromEntries({
      recordId: resolvedRecordId,
      recordEntry: recordEntryItem ? recordEntryItem.graphResult.sidecarEntry : null,
      sliceEntries,
      generatedAt,
      updatedAt: generatedAt
    });
  } catch {

    return { byIndex: new Map(), sidecar: null, path: sidecarPath, digest: null, counts: emptyGraphCounts() };
  }
  const digest = computeGraphEvidenceSidecarDigest(sidecar);

  const byIndex = new Map();
  const counts = emptyGraphCounts();
  for (const item of staged) {
    const finalized = finalizeEntryGraphSidecarization(item.originalEntry, item.graphResult, digest);
    byIndex.set(item.index, {
      compactedEntry: finalized.compactedEntry,
      inlineRef: finalized.inlineRef,
      sidecarEntry: item.graphResult.sidecarEntry,
      isRecordEntry: item.graphResult.isRecordEntry,
      sliceKey: item.graphResult.sliceKey,
      reclaimedBytes: finalized.reclaimedBytes
    });
    counts.updates += 1;
    if (item.graphResult.replayDetailAvailable) {
      counts.replay_detail_available += 1;
    } else {
      counts.compact_only += 1;
    }
    counts.reclaimed_bytes += finalized.reclaimedBytes;
  }

  return { byIndex, sidecar, path: sidecarPath, digest, counts };
}

function emptyGraphCounts() {
  return { updates: 0, replay_detail_available: 0, compact_only: 0, reclaimed_bytes: 0 };
}

function computeCleanup(derivedEvidence, { compact = false, recordId = null } = {}) {
  const entries = Array.isArray(derivedEvidence) ? derivedEvidence : [];

  const usableGroups = new Map();
  let malformedCount = 0;
  let ungroupableCount = 0;
  let preservedCount = 0;
  const preservedClasses = {};
  const refreshIncompatibleSidecars = [];

  entries.forEach((entry, index) => {
    const cls = entryClass(entry);
    if (cls === "preserved") {
      preservedCount += 1;
      const label = preservedClassLabel(entry);
      preservedClasses[label] = (preservedClasses[label] ?? 0) + 1;
      return;
    }
    if (cls === "worker_admission_malformed") {
      malformedCount += 1;
      if (resolveUnitAddress(entry) === null) {
        ungroupableCount += 1;
      }
      return;
    }
    if (cls === WORKER_ADMISSION_REFRESH_INCOMPATIBLE_SIDECAR_CLASS) {
      refreshIncompatibleSidecars.push({
        index,
        address: resolveUnitAddress(entry),
        generated_at: normalizeStringEntry(entry.generated_at),
        source_record_digest: normalizeStringEntry(entry.source_record_digest),
        sidecar_path: normalizeStringEntry(entry.sidecar_path),
        sidecar_digest: normalizeStringEntry(entry.sidecar_digest),
        diagnostic_code: "refresh_incompatible_worker_admission_sidecar",
        diagnostic_path: isObject(entry.admission_summary)
          ? `derived_evidence[${index}].admission_summary.result`
          : `derived_evidence[${index}].admission_summary`,
        next_action:
          "Refresh the selected unit admission evidence or repair the compact admission_summary.result before treating this sidecar-backed entry as usable."
      });
      return;
    }
    const address = resolveUnitAddress(entry);
    const group = usableGroups.get(address) ?? [];
    group.push({ index, millis: generatedAtMillis(entry) });
    usableGroups.set(address, group);
  });

  const removedIndices = new Set();
  const units = [];
  const sidecarByIndex = new Map();
  let duplicateUnitCount = 0;
  let compactedCount = 0;
  const sidecars = [];
  for (const [address, group] of usableGroups) {
    const newest = group.reduce((best, candidate) => {
      if (candidate.millis > best.millis) {
        return candidate;
      }
      if (candidate.millis === best.millis && candidate.index > best.index) {
        return candidate;
      }
      return best;
    });
    const removedForUnit = group.filter((candidate) => candidate.index !== newest.index);
    for (const candidate of removedForUnit) {
      removedIndices.add(candidate.index);
    }
    if (removedForUnit.length > 0) {
      duplicateUnitCount += 1;
    }
    const keptEntry = entries[newest.index];
    const compactCandidate = buildCompactWorkerAdmissionCleanupCandidate(keptEntry);
    if (compactCandidate) {
      sidecarByIndex.set(newest.index, compactCandidate);
      compactedCount += 1;
      sidecars.push({
        index: newest.index,
        address,
        path: compactCandidate.sidecar.path,
        digest: compactCandidate.sidecar.digest,
        entry: compactCandidate.sidecar.entry
      });
    }
    units.push({
      address,
      before: group.length,
      retained: 1,
      removed: removedForUnit.length,
      kept_generated_at: normalizeStringEntry(
        sidecarByIndex.get(newest.index)?.entry.generated_at ?? keptEntry.generated_at
      ),
      kept_source_record_digest: normalizeStringEntry(
        sidecarByIndex.get(newest.index)?.entry.source_record_digest ?? keptEntry.source_record_digest
      ),
      kept_sidecar_path:
        normalizeStringEntry(sidecarByIndex.get(newest.index)?.entry.sidecar_path) ??
        normalizeStringEntry(sidecarByIndex.get(newest.index)?.sidecar?.path) ??
        null,
      kept_sidecar_digest:
        normalizeStringEntry(sidecarByIndex.get(newest.index)?.entry.sidecar_digest) ??
        normalizeStringEntry(sidecarByIndex.get(newest.index)?.sidecar?.digest) ??
        null
    });
  }

  units.sort((left, right) => String(left.address).localeCompare(String(right.address)));

  const keptIndexed = [];
  entries.forEach((entry, index) => {
    if (removedIndices.has(index)) {
      return;
    }
    const compactCandidate = sidecarByIndex.get(index) ?? null;
    keptIndexed.push({ index, entry: compactCandidate ? compactCandidate.entry : entry });
  });

  const graph = computeGraphSidecarization(recordId, keptIndexed);

  const kept = [];

  const keptCompacted = [];
  const keptDescriptors = [];
  const removed = [];
  entries.forEach((entry, index) => {
    if (removedIndices.has(index)) {
      removed.push({ index, entry });
      return;
    }
    const compactCandidate = sidecarByIndex.get(index) ?? null;
    const graphResult = graph.byIndex.get(index) ?? null;

    const admissionBase = compactCandidate ? compactCandidate.entry : cloneJson(entry);
    const fullyCompacted = graphResult ? graphResult.compactedEntry : admissionBase;

    const normalizedEntry = compact ? cloneJson(fullyCompacted) : cloneJson(entry);
    kept.push(normalizedEntry);

    keptCompacted.push(cloneJson(fullyCompacted));
    if (isWorkerAdmissionEntry(normalizedEntry)) {
      keptDescriptors.push(
        compactRetainedDescriptor(normalizedEntry, index, compactCandidate?.sidecar ?? null)
      );
    }
  });

  return {
    entries,
    kept,
    keptCompacted,
    keptDescriptors,
    removed,
    sidecars,
    graph,
    units,
    refreshIncompatibleSidecars,
    counts: {
      total: entries.length,
      worker_admission: entries.filter(isWorkerAdmissionEntry).length,
      preserved: preservedCount,
      malformed: malformedCount,
      ungroupable: ungroupableCount,
      duplicate_units: duplicateUnitCount,
      compacted: compactedCount,
      graph_compacted: graph.counts.updates,
      refresh_incompatible_sidecars: refreshIncompatibleSidecars.length
    },
    preservedClasses
  };
}

function nextAction(
  mode,
  changed,
  removedCount,
  duplicateUnitCount,
  compactedCount,
  graphCompactedCount,
  refreshIncompatibleSidecarCount = 0
) {
  if (!changed && refreshIncompatibleSidecarCount > 0) {
    return `Refresh or repair ${refreshIncompatibleSidecarCount} compact worker-admission sidecar entr${
      refreshIncompatibleSidecarCount === 1 ? "y" : "ies"
    } whose inline admission_summary.result is missing before treating it as usable evidence.`;
  }
  if (!changed) {
    return "No superseded worker-admission derived-evidence entries; no cleanup needed.";
  }
  if (mode === "plan") {
    const removalClause =
      removedCount > 0
        ? `remove ${removedCount} superseded worker-admission derived-evidence entr${
            removedCount === 1 ? "y" : "ies"
          }`
        : null;
    const compactionClause =
      compactedCount > 0
        ? `sidecarize ${compactedCount} legacy inline worker-admission entr${
            compactedCount === 1 ? "y" : "ies"
          }`
        : null;
    const graphClause =
      graphCompactedCount > 0
        ? `move ${graphCompactedCount} inline graph-impact payload${
            graphCompactedCount === 1 ? "" : "s"
          } into the per-WK graph sidecar`
        : null;
    const refreshIncompatibleClause =
      refreshIncompatibleSidecarCount > 0
        ? `report ${refreshIncompatibleSidecarCount} compact worker-admission sidecar entr${
            refreshIncompatibleSidecarCount === 1 ? "y" : "ies"
          } that refresh would reject before recomputation`
        : null;
    const clauses = [removalClause, compactionClause, graphClause, refreshIncompatibleClause]
      .filter(Boolean)
      .join("; ");
    return (
      `Apply cleanup to ${clauses} across ${duplicateUnitCount} unit${
        duplicateUnitCount === 1 ? "" : "s"
      }; run the apply/write path to persist and write the WK-named sidecars.`
    );
  }
  return "Persist the updated record through validated work-record persistence with stale-source protection and write the WK-named worker-admission and graph sidecars for any compacted entries.";
}

function buildReport({ record, cleanup, mode, verbose }) {
  const beforeBytes = approxJsonBytes(cleanup.entries);

  const afterBytes = approxJsonBytes(cleanup.keptCompacted ?? cleanup.kept);
  const removedCount = cleanup.removed.length;
  const compactedCount = cleanup.counts.compacted;
  const graphCounts = cleanup.graph?.counts ?? { updates: 0, replay_detail_available: 0, compact_only: 0, reclaimed_bytes: 0 };
  const graphCompactedCount = graphCounts.updates;
  const changed = removedCount > 0 || compactedCount > 0 || graphCompactedCount > 0;
  const refreshIncompatibleSidecarCount = cleanup.counts.refresh_incompatible_sidecars;

  const report = {
    schema_version: WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_SCHEMA_VERSION,
    kind: WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_KIND,
    mode,
    record_id: normalizeStringEntry(record?.id) ?? null,
    changed,
    before: {
      total: cleanup.counts.total,
      worker_admission: cleanup.counts.worker_admission,
      preserved: cleanup.counts.preserved,
      approx_bytes: beforeBytes
    },
    after: {
      total: cleanup.kept.length,
      worker_admission: cleanup.kept.filter(isWorkerAdmissionEntry).length,
      preserved: cleanup.counts.preserved,
      approx_bytes: afterBytes
    },
    removed: {
      count: removedCount,
      approx_bytes_reclaimed: Math.max(0, beforeBytes - afterBytes)
    },
    units: cleanup.units,
    retained: cleanup.keptDescriptors,
    sidecars: cleanup.sidecars.map(({ index, path: sidecarPath, digest, entry }) => ({
      index,
      path: sidecarPath,
      digest,
      address: resolveUnitAddress(entry),
      generated_at: normalizeStringEntry(entry.generated_at),
      source_record_digest: normalizeStringEntry(entry.source_record_digest)
    })),
    graph_sidecar: buildGraphSidecarReport(cleanup.graph, graphCounts),
    diagnostics: {
      duplicate_unit_count: cleanup.counts.duplicate_units,
      removed_entry_count: removedCount,
      compacted_worker_admission_count: compactedCount,
      sidecar_entry_count: cleanup.sidecars.length,
      graph_sidecar_update_count: graphCompactedCount,
      refresh_incompatible_worker_admission_sidecar_count: refreshIncompatibleSidecarCount,
      refresh_incompatible_worker_admission_sidecars: cloneJson(
        cleanup.refreshIncompatibleSidecars
      ),
      malformed_worker_admission_count: cleanup.counts.malformed,
      ungroupable_worker_admission_count: cleanup.counts.ungroupable,
      preserved_non_worker_admission_count: cleanup.counts.preserved,
      preserved_classes: cleanup.preservedClasses
    },
    next_action: nextAction(
      mode,
      changed,
      removedCount,
      cleanup.counts.duplicate_units,
      compactedCount,
      graphCompactedCount,
      refreshIncompatibleSidecarCount
    )
  };

  if (verbose) {
    report.verbose = true;

    report.removed_entries = cleanup.removed.map(({ index, entry }) => ({
      index,
      entry: cloneJson(entry)
    }));
    report.sidecar_entries = cleanup.sidecars.map(({ index, path: sidecarPath, digest, entry }) => ({
      index,
      path: sidecarPath,
      digest,
      entry: cloneJson(entry)
    }));

    if (cleanup.graph?.sidecar) {
      report.graph_sidecar_file = cloneJson(cleanup.graph.sidecar);
    }
  }

  return report;
}

function buildGraphSidecarReport(graph, graphCounts) {
  return {
    path: graph?.path ?? null,
    digest: graph?.digest ?? null,
    updates: graphCounts.updates,
    replay_detail_available: graphCounts.replay_detail_available,
    compact_only: graphCounts.compact_only,
    approx_bytes_reclaimed: graphCounts.reclaimed_bytes,
    slice_entry_count: graph?.sidecar?.slices ? Object.keys(graph.sidecar.slices).length : 0,
    record_entry: Boolean(graph?.sidecar?.record)
  };
}

export function detectWorkRecordCleanupSidecarPathCollisions(sidecars) {
  const byPath = new Map();
  for (const sidecar of Array.isArray(sidecars) ? sidecars : []) {
    const sidecarPath = normalizeStringEntry(sidecar?.path);
    if (!sidecarPath) {
      continue;
    }
    const group = byPath.get(sidecarPath) ?? [];
    group.push(sidecar);
    byPath.set(sidecarPath, group);
  }

  const collisions = [];
  for (const [sidecarPath, group] of byPath) {
    if (group.length <= 1) {
      continue;
    }
    collisions.push({
      path: sidecarPath,
      count: group.length,
      addresses: group.map((sidecar) => normalizeStringEntry(sidecar?.address) ?? null),
      indices: group.map((sidecar) => (Number.isInteger(sidecar?.index) ? sidecar.index : null))
    });
  }
  collisions.sort((left, right) => String(left.path).localeCompare(String(right.path)));
  return collisions;
}

export function planWorkRecordDerivedEvidenceCleanup(record, options = {}) {
  const sourceRecord = isObject(record) ? record : null;
  const verbose = options.verbose === true;
  const cleanup = computeCleanup(sourceRecord?.derived_evidence, {
    compact: false,
    recordId: sourceRecord?.id ?? null
  });
  const report = buildReport({ record: sourceRecord, cleanup, mode: "plan", verbose });
  return {
    report,
    cleaned_derived_evidence: cloneJson(cleanup.kept),
    graph_sidecar: buildGraphSidecarBundle(cleanup.graph)
  };
}

function buildGraphSidecarBundle(graph) {
  if (!graph || !graph.sidecar || !graph.path) {
    return null;
  }
  const inlineRefs = [];
  for (const [index, result] of graph.byIndex) {
    inlineRefs.push({ index, inline_ref: cloneJson(result.inlineRef) });
  }
  inlineRefs.sort((left, right) => left.index - right.index);
  return {
    path: graph.path,
    digest: graph.digest,
    sidecar: cloneJson(graph.sidecar),
    inline_refs: inlineRefs
  };
}

export function applyWorkRecordDerivedEvidenceCleanup(record, options = {}) {
  if (!isObject(record)) {
    throw new Error("applyWorkRecordDerivedEvidenceCleanup requires a record object");
  }
  const verbose = options.verbose === true;
  const cleanup = computeCleanup(record.derived_evidence, { compact: true, recordId: record.id ?? null });
  const report = buildReport({ record, cleanup, mode: "apply", verbose });
  const updatedRecord = cloneJson(record);
  updatedRecord.derived_evidence = cloneJson(cleanup.kept);
  return {
    record: updatedRecord,
    report,
    graph_sidecar: buildGraphSidecarBundle(cleanup.graph)
  };
}
