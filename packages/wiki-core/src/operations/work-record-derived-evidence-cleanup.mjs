import path from "node:path";

import {
  applyWorkRecordDerivedEvidenceCleanup,
  planWorkRecordDerivedEvidenceCleanup
} from "../lib/work-record-derived-evidence-cleanup.mjs";
import {
  getWorkRecordDirectory,
  listWorkRecordJsonPaths
} from "../lib/work-record-store.mjs";
import { canonicalizeWorkRecordReadScope } from "../lib/work-record-schema.mjs";
import { digestWorkRecord, readWorkRecordById, readWorkRecordByPath, writeValidatedWorkRecord } from "./work-records.mjs";
import {
  applyFinalGraphSidecarDigest,
  collectSidecarCollisionDiagnostics,
  describeCleanupError,
  persistCleanupGraphSidecar,
  persistCleanupSidecars,
  rollbackCleanupSidecarWrites
} from "./work-record-derived-evidence-cleanup-sidecar-io.mjs";

const CANONICAL_WORK_RECORD_BASENAME_PATTERN = /^WK-[0-9]{4}\.json$/;

function isBlockingDiagnostic(diagnostic) {
  return Boolean(diagnostic) && diagnostic.severity === "error";
}

function normalizeExpectedSourceDigest(options) {
  if (!options) {
    return null;
  }

  if (options.expectedSourceDigest !== undefined && options.expectedSourceDigest !== null) {
    return options.expectedSourceDigest;
  }

  if (options.expected_source_digest !== undefined && options.expected_source_digest !== null) {
    return options.expected_source_digest;
  }

  return null;
}

function createInvalidCleanupResult({
  loaded = null,
  diagnostics = [],
  recordId = null,
  sourcePath = null,
  sourcePathRelative = null
} = {}) {
  return {
    record_id: recordId,
    source_path: sourcePath,
    source_path_relative: sourcePathRelative,
    source_digest: null,
    current_source_digest: loaded?.source_digest || null,
    expected_source_digest: null,
    use_as_expected_source_digest: null,
    no_op: false,
    canonical_record_path: null,
    valid: false,
    written: false,
    report: null,
    diagnostics
  };
}

function createCleanupResult({
  loaded,
  report,
  sourceDigest,
  expectedSourceDigest = null,
  currentSourceDigest = null,
  useAsExpectedSourceDigest = null,
  written = false,
  valid = true,
  diagnostics = [],
  canonicalRecordPath = null
} = {}) {
  return {
    record_id: loaded?.record_id || loaded?.record?.id || null,
    source_path: loaded?.source_path || null,
    source_path_relative: loaded?.source_path_relative || null,
    source_digest: sourceDigest || null,
    current_source_digest: currentSourceDigest || loaded?.source_digest || null,
    expected_source_digest: expectedSourceDigest === undefined ? null : expectedSourceDigest,

    use_as_expected_source_digest: useAsExpectedSourceDigest,

    no_op: report ? !report.changed : false,
    canonical_record_path: canonicalRecordPath || loaded?.canonical_record_path || null,
    valid: Boolean(valid),
    written: Boolean(written),
    report,
    diagnostics
  };
}

async function loadWorkRecordForCleanup({ dir, id, path: requestedPath, recordStore }) {
  if (requestedPath) {
    return readWorkRecordByPath({ dir, path: requestedPath, recordStore });
  }

  if (id) {
    return readWorkRecordById({ dir, id, recordStore });
  }

  return {
    valid: false,
    written: false,
    record_id: null,
    source_path: null,
    source_path_relative: null,
    source_digest: null,
    record: null,
    diagnostics: [
      {
        code: "missing_selector",
        severity: "error",
        message: "cleanup requires id or path",
        path: "id"
      }
    ]
  };
}

export async function cleanupWorkRecordDerivedEvidenceOperation({
  dir = ".",
  id = null,
  path: requestedPath = null,
  recordStore = null,
  verbose = false,
  write = false,
  expectedSourceDigest = undefined,
  expected_source_digest = undefined
} = {}) {
  const targetDir = path.resolve(String(dir));
  const loaded = await loadWorkRecordForCleanup({
    dir: targetDir,
    id,
    path: requestedPath,
    recordStore
  });

  if (!loaded.record || (Array.isArray(loaded.diagnostics) && loaded.diagnostics.some(isBlockingDiagnostic))) {
    return createInvalidCleanupResult({
      loaded,
      diagnostics: loaded.diagnostics || [],
      recordId: loaded.record_id || null,
      sourcePath: loaded.source_path || null,
      sourcePathRelative: loaded.source_path_relative || null
    });
  }

  const expectedDigest = normalizeExpectedSourceDigest({
    expectedSourceDigest,
    expected_source_digest
  });

  if (write) {
    const planned = planWorkRecordDerivedEvidenceCleanup(loaded.record, { verbose: true });
    const applied = applyWorkRecordDerivedEvidenceCleanup(loaded.record, { verbose });

    const sourceDigest = digestWorkRecord(canonicalizeWorkRecordReadScope(applied.record));

    const collisionDiagnostics = collectSidecarCollisionDiagnostics(applied.report);
    if (collisionDiagnostics.length > 0) {
      return createCleanupResult({
        loaded,
        report: applied.report,
        sourceDigest,
        expectedSourceDigest: expectedDigest,
        currentSourceDigest: loaded.source_digest || null,
        useAsExpectedSourceDigest: null,
        written: false,
        valid: false,
        diagnostics: collisionDiagnostics,
        canonicalRecordPath: loaded.canonical_record_path || loaded.source_path || null
      });
    }

    const sidecarEntries = Array.isArray(planned.report?.sidecar_entries) ? planned.report.sidecar_entries : [];
    const sidecarWriteResult = await persistCleanupSidecars(targetDir, sidecarEntries);
    if (!sidecarWriteResult.ok) {
      return createCleanupResult({
        loaded,
        report: applied.report,
        sourceDigest,
        expectedSourceDigest: expectedDigest,
        currentSourceDigest: loaded.source_digest || null,
        useAsExpectedSourceDigest: null,
        written: false,
        valid: false,
        diagnostics: sidecarWriteResult.diagnostics,
        canonicalRecordPath: loaded.canonical_record_path || loaded.source_path || null
      });
    }

    const graphSidecarWriteResult = await persistCleanupGraphSidecar(targetDir, applied.graph_sidecar);
    if (!graphSidecarWriteResult.ok) {
      const rollbackDiagnostics = await rollbackCleanupSidecarWrites(sidecarWriteResult.writtenEntries || []);
      return createCleanupResult({
        loaded,
        report: applied.report,
        sourceDigest,
        expectedSourceDigest: expectedDigest,
        currentSourceDigest: loaded.source_digest || null,
        useAsExpectedSourceDigest: null,
        written: false,
        valid: false,
        diagnostics: [...graphSidecarWriteResult.diagnostics, ...rollbackDiagnostics],
        canonicalRecordPath: loaded.canonical_record_path || loaded.source_path || null
      });
    }

    const allSidecarWrites = [
      ...(sidecarWriteResult.writtenEntries || []),
      ...(graphSidecarWriteResult.writtenEntries || [])
    ];

    applyFinalGraphSidecarDigest({
      record: applied.record,
      report: applied.report,
      sidecarRelativePath: graphSidecarWriteResult.relativePath ?? applied.graph_sidecar?.path ?? null,
      finalDigest: graphSidecarWriteResult.finalDigest
    });

    const writeResult = await writeValidatedWorkRecord({
      dir: targetDir,
      record: applied.record,
      expectedSourceDigest: expectedDigest,
      recordStore
    });

    const writeDiagnostics = Array.isArray(writeResult.diagnostics) ? writeResult.diagnostics : [];
    if (!writeResult.written) {
      const rollbackDiagnostics = await rollbackCleanupSidecarWrites(allSidecarWrites);
      return createCleanupResult({
        loaded,
        report: applied.report,
        sourceDigest,
        expectedSourceDigest: expectedDigest,
        currentSourceDigest: writeResult.current_source_digest || loaded.source_digest || null,
        useAsExpectedSourceDigest: null,
        written: false,
        valid: Boolean(writeResult.valid),
        diagnostics: [...writeDiagnostics, ...rollbackDiagnostics],
        canonicalRecordPath: writeResult.canonical_record_path || loaded.source_path || null
      });
    }

    return createCleanupResult({
      loaded,
      report: applied.report,
      sourceDigest,
      expectedSourceDigest: expectedDigest,
      currentSourceDigest: writeResult.current_source_digest || loaded.source_digest || null,
      useAsExpectedSourceDigest: null,
      written: Boolean(writeResult.written),
      valid: Boolean(writeResult.valid),
      diagnostics: writeDiagnostics,
      canonicalRecordPath: writeResult.canonical_record_path || loaded.source_path || null
    });
  }

  const planned = planWorkRecordDerivedEvidenceCleanup(loaded.record, { verbose });
  const sourceDigest = digestWorkRecord({
    ...loaded.record,
    derived_evidence: planned.cleaned_derived_evidence
  });

  const planCollisionDiagnostics = collectSidecarCollisionDiagnostics(planned.report);

  return createCleanupResult({
    loaded,
    report: planned.report,
    sourceDigest,
    expectedSourceDigest: expectedDigest,
    currentSourceDigest: loaded.source_digest || null,

    useAsExpectedSourceDigest: loaded.source_digest || null,
    written: false,
    valid: Boolean(loaded.valid),
    diagnostics: [...(loaded.diagnostics || []), ...planCollisionDiagnostics],
    canonicalRecordPath: loaded.canonical_record_path || loaded.source_path || null
  });
}

export const WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_ALL_SCHEMA_VERSION =
  "work-record-derived-evidence-cleanup-all.v1";
export const WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_ALL_KIND =
  "work_record_derived_evidence_cleanup_all";

export const WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_ALL_MAX_CONCURRENCY = 64;

export const WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_ALL_DEFAULT_CONCURRENCY = Object.freeze({
  plan: 8,
  apply: 4
});

export function defaultCleanupConcurrency({ write = false } = {}) {
  return write
    ? WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_ALL_DEFAULT_CONCURRENCY.apply
    : WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_ALL_DEFAULT_CONCURRENCY.plan;
}

function invalidCleanupConcurrencyDiagnostic(received) {
  return {
    code: "invalid_concurrency",
    severity: "error",
    message:
      "cleanup --concurrency must be a positive integer between 1 and " +
      `${WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_ALL_MAX_CONCURRENCY}; received ${JSON.stringify(received)}`,
    path: "concurrency"
  };
}

export function normalizeCleanupConcurrency(value, { write = false } = {}) {
  if (value === null || value === undefined) {
    return { ok: true, value: defaultCleanupConcurrency({ write }) };
  }

  let numeric;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[0-9]+$/.test(trimmed)) {
      return { ok: false, diagnostic: invalidCleanupConcurrencyDiagnostic(value) };
    }
    numeric = Number(trimmed);
  } else {
    return { ok: false, diagnostic: invalidCleanupConcurrencyDiagnostic(value) };
  }

  if (!Number.isInteger(numeric) || numeric < 1) {
    return { ok: false, diagnostic: invalidCleanupConcurrencyDiagnostic(value) };
  }
  if (numeric > WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_ALL_MAX_CONCURRENCY) {
    return { ok: false, diagnostic: invalidCleanupConcurrencyDiagnostic(value) };
  }

  return { ok: true, value: numeric };
}

export async function mapWithBoundedConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  if (items.length === 0) {
    return results;
  }

  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  async function runLane() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  }

  const lanes = [];
  for (let lane = 0; lane < effectiveLimit; lane += 1) {
    lanes.push(runLane());
  }
  await Promise.all(lanes);
  return results;
}

const WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_ALL_PARTIAL_WRITE_POLICY = Object.freeze({
  per_record_isolation:
    "Each record is planned, then written independently; a per-record skip, refusal, or write failure never aborts the remaining records.",
  stale_digest:
    "The broad sweep loads and digests each record fresh immediately before its own write; it never reuses a cross-record expected_source_digest. To gate a single record on a known digest, run the single-record cleanup-derived-evidence path with --expected-source-digest instead.",
  per_record_validation:
    "Each pruned record is validated through writeValidatedWorkRecord before its canonical JSON is replaced; an invalid pruned record is refused without writing.",
  sidecar_rollback:
    "WK-named sidecars for a record are written before that record's canonical JSON. If the canonical write fails or refuses, the sidecars written for that record are rolled back to their prior content (or removed when newly created). The per-WK graph sidecar rollback is concurrency-safe: it rereads the file first and skips rollback (reporting graph_sidecar_rollback_skipped_concurrent_update or graph_sidecar_rollback_recheck_failed) if a concurrent writer changed, deleted, or made the file unrecheckable since this writer wrote it, rather than clobbering that update.",
  collision_guard:
    "Before any write, retained entries that would target the same sidecar path are detected and the record is refused, so one retained payload can never overwrite another.",
  crash_recovery:
    "A crash between a sidecar write and its canonical write can leave an orphan sidecar under wiki/work-records/evidence/. The cleanup is idempotent: rerun it (dry-run first) to reconcile. Orphan sidecars are inert debug/replay payloads and never add dispatch authority.",
  concurrency:
    "Records are processed with bounded concurrency (one independent task per record). Each task loads and digests its record fresh, writes only its own WK-named sidecars and canonical JSON via atomic per-file replace, and isolates its skip/refusal/write failure from siblings. Report ordering is fixed by WK id regardless of completion order."
});

function normalizeRequestedRecordIds(ids) {
  if (ids === null || ids === undefined) {
    return { ok: true, ids: null, invalid: [] };
  }
  if (!Array.isArray(ids)) {
    return {
      ok: false,
      diagnostic: {
        code: "invalid_record_filter",
        severity: "error",
        message: "cleanup --records filter must be an array of WK-#### ids",
        path: "ids"
      }
    };
  }

  const seen = new Set();
  const normalized = [];
  const invalid = [];
  for (const raw of ids) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!/^WK-[0-9]{4}$/.test(id)) {
      invalid.push(typeof raw === "string" ? raw : String(raw));
      continue;
    }
    if (!seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }

  if (invalid.length > 0) {
    return {
      ok: false,
      diagnostic: {
        code: "invalid_record_filter",
        severity: "error",
        message: `cleanup --records filter contains non-canonical id(s): ${invalid.join(", ")}`,
        path: "ids"
      }
    };
  }

  return { ok: true, ids: normalized, invalid };
}

async function listCanonicalWorkRecordIds(targetDir) {
  const jsonPaths = await listWorkRecordJsonPaths(targetDir);
  const workRecordDir = getWorkRecordDirectory(targetDir);
  const ids = [];
  for (const absolutePath of jsonPaths) {
    if (path.dirname(absolutePath) !== workRecordDir) {
      continue;
    }
    const base = path.basename(absolutePath);
    if (!CANONICAL_WORK_RECORD_BASENAME_PATTERN.test(base)) {
      continue;
    }
    ids.push(base.slice(0, -".json".length));
  }
  ids.sort((left, right) => left.localeCompare(right));
  return ids;
}

function summarizeSweepRecord(recordId, status, { reason = null, diagnostics = [], result = null } = {}) {
  const report = result?.report ?? null;
  const before = report?.before ?? null;
  const after = report?.after ?? null;
  const sidecarPaths = Array.isArray(report?.sidecars)
    ? report.sidecars.map((sidecar) => sidecar?.path).filter((value) => typeof value === "string")
    : [];
  const graphSidecar = report?.graph_sidecar ?? null;
  const graphUpdates = graphSidecar?.updates ?? 0;
  return {
    record_id: recordId,
    status,
    reason,
    written: Boolean(result?.written),
    before_evidence_count: before?.total ?? null,
    after_evidence_count: after?.total ?? null,
    before_approx_bytes: before?.approx_bytes ?? null,
    after_approx_bytes: after?.approx_bytes ?? null,
    removed_count: report?.removed?.count ?? 0,
    approx_bytes_reclaimed: report?.removed?.approx_bytes_reclaimed ?? 0,
    planned_sidecar_count: sidecarPaths.length,
    sidecars_written: status === "changed" ? sidecarPaths.length : 0,
    sidecar_paths: sidecarPaths,
    graph_sidecar_path: graphSidecar?.path ?? null,
    graph_sidecar_updates: graphUpdates,
    graph_sidecar_written: status === "changed" ? graphUpdates : 0,
    graph_approx_bytes_reclaimed: graphSidecar?.approx_bytes_reclaimed ?? 0,
    diagnostics: diagnostics.length > 0 ? diagnostics : report ? [] : diagnostics
  };
}

async function cleanupSweepRecord({ targetDir, id, recordStore, write }) {
  let plan;
  try {
    plan = await cleanupWorkRecordDerivedEvidenceOperation({
      dir: targetDir,
      id,
      write: false,
      verbose: false,
      recordStore
    });
  } catch (error) {
    return summarizeSweepRecord(id, "skipped", {
      reason: `cleanup threw during plan: ${describeCleanupError(error)}`,
      diagnostics: [
        {
          code: "cleanup_plan_threw",
          severity: "error",
          message: describeCleanupError(error),
          path: id
        }
      ]
    });
  }

  const planErrors = (plan.diagnostics || []).filter((entry) => entry?.severity === "error");
  const planCollisions = planErrors.filter((entry) => entry?.code === "cleanup_sidecar_path_collision");

  if (!plan.report) {
    return summarizeSweepRecord(id, "skipped", {
      reason: planErrors[0]?.message ?? "no cleanup report produced",
      diagnostics: planErrors,
      result: plan
    });
  }

  if (planCollisions.length > 0) {
    return summarizeSweepRecord(id, "refused", {
      reason: planCollisions[0].message,
      diagnostics: planCollisions,
      result: plan
    });
  }

  if (!plan.report.changed) {
    return summarizeSweepRecord(id, "no_op", { result: plan });
  }

  if (!write) {
    return summarizeSweepRecord(id, "would_change", { result: plan });
  }

  let applied;
  try {
    applied = await cleanupWorkRecordDerivedEvidenceOperation({
      dir: targetDir,
      id,
      write: true,
      verbose: false,
      recordStore
    });
  } catch (error) {
    return summarizeSweepRecord(id, "write_failed", {
      reason: `cleanup threw during write: ${describeCleanupError(error)}`,
      diagnostics: [
        {
          code: "cleanup_write_threw",
          severity: "error",
          message: describeCleanupError(error),
          path: id
        }
      ],
      result: plan
    });
  }

  const appliedErrors = (applied.diagnostics || []).filter((entry) => entry?.severity === "error");
  const appliedCollisions = appliedErrors.filter((entry) => entry?.code === "cleanup_sidecar_path_collision");

  if (appliedCollisions.length > 0) {
    return summarizeSweepRecord(id, "refused", {
      reason: appliedCollisions[0].message,
      diagnostics: appliedCollisions,
      result: applied
    });
  }

  if (!applied.written) {
    return summarizeSweepRecord(id, "write_failed", {
      reason: appliedErrors[0]?.message ?? "record write did not complete",
      diagnostics: appliedErrors,
      result: applied
    });
  }

  return summarizeSweepRecord(id, "changed", { result: applied });
}

function createInvalidSweepResult({ dir, write, diagnostic }) {
  return {
    dir,
    write: Boolean(write),
    written: false,
    valid: false,
    invalid_request: true,
    report: null,
    diagnostics: [diagnostic]
  };
}

export async function cleanupAllWorkRecordsDerivedEvidenceOperation({
  dir = ".",
  ids = null,
  recordStore = null,
  verbose = false,
  write = false,
  concurrency = null
} = {}) {
  const targetDir = path.resolve(String(dir));

  const requested = normalizeRequestedRecordIds(ids);
  if (!requested.ok) {
    return createInvalidSweepResult({ dir: targetDir, write, diagnostic: requested.diagnostic });
  }

  const resolvedConcurrency = normalizeCleanupConcurrency(concurrency, { write });
  if (!resolvedConcurrency.ok) {
    return createInvalidSweepResult({ dir: targetDir, write, diagnostic: resolvedConcurrency.diagnostic });
  }

  const discovered = await listCanonicalWorkRecordIds(targetDir);
  const discoveredSet = new Set(discovered);

  const missingRequestedIds = [];
  let selectedIds;
  if (requested.ids === null) {
    selectedIds = discovered;
  } else {
    selectedIds = [];
    for (const id of requested.ids) {
      if (discoveredSet.has(id)) {
        selectedIds.push(id);
      } else {
        missingRequestedIds.push(id);
      }
    }
  }

  const perRecord = await mapWithBoundedConcurrency(
    selectedIds,
    resolvedConcurrency.value,
    (id) => cleanupSweepRecord({ targetDir, id, recordStore, write })
  );

  for (const id of missingRequestedIds) {
    perRecord.push(
      summarizeSweepRecord(id, "skipped", {
        reason: "no canonical wiki/work-records/WK-*.json record exists for the requested id",
        diagnostics: [
          {
            code: "missing_json_record",
            severity: "error",
            message: `Missing canonical work record JSON: wiki/work-records/${id}.json`,
            path: id
          }
        ]
      })
    );
  }

  const tally = {
    changed: 0,
    would_change: 0,
    no_op: 0,
    refused: 0,
    skipped: 0,
    write_failed: 0
  };
  let sidecarsWritten = 0;
  let approxBytesReclaimed = 0;
  let graphSidecarUpdates = 0;
  let graphRecordsSidecarized = 0;
  let graphApproxBytesReclaimed = 0;
  for (const entry of perRecord) {
    tally[entry.status] = (tally[entry.status] ?? 0) + 1;
    sidecarsWritten += entry.sidecars_written ?? 0;
    if (entry.status === "changed" || entry.status === "would_change") {
      approxBytesReclaimed += entry.approx_bytes_reclaimed ?? 0;
      const recordGraphUpdates = entry.graph_sidecar_updates ?? 0;
      graphSidecarUpdates += recordGraphUpdates;
      graphApproxBytesReclaimed += entry.graph_approx_bytes_reclaimed ?? 0;
      if (recordGraphUpdates > 0) {
        graphRecordsSidecarized += 1;
      }
    }
  }

  const compactPerRecord = perRecord.map((entry) => {
    const compact = {
      record_id: entry.record_id,
      status: entry.status,
      reason: entry.reason,
      written: entry.written,
      before_evidence_count: entry.before_evidence_count,
      after_evidence_count: entry.after_evidence_count,
      before_approx_bytes: entry.before_approx_bytes,
      after_approx_bytes: entry.after_approx_bytes,
      removed_count: entry.removed_count,
      approx_bytes_reclaimed: entry.approx_bytes_reclaimed,
      planned_sidecar_count: entry.planned_sidecar_count,
      sidecars_written: entry.sidecars_written,
      graph_sidecar_updates: entry.graph_sidecar_updates ?? 0,
      graph_approx_bytes_reclaimed: entry.graph_approx_bytes_reclaimed ?? 0
    };
    if (verbose) {
      compact.sidecar_paths = entry.sidecar_paths;
      compact.graph_sidecar_path = entry.graph_sidecar_path;
      compact.diagnostics = entry.diagnostics;
    }
    return compact;
  });

  const skipped = perRecord
    .filter((entry) => entry.status === "skipped" || entry.status === "refused" || entry.status === "write_failed")
    .map((entry) => ({ record_id: entry.record_id, status: entry.status, reason: entry.reason }));

  const report = {
    schema_version: WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_ALL_SCHEMA_VERSION,
    kind: WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_ALL_KIND,
    mode: write ? "apply" : "plan",
    scope: requested.ids === null ? "all" : "filtered",
    concurrency: resolvedConcurrency.value,
    requested_record_ids: requested.ids === null ? null : requested.ids,
    records_scanned: perRecord.length,
    records_changed: tally.changed + tally.would_change,
    records_written: tally.changed,
    records_no_op: tally.no_op,
    records_refused: tally.refused,
    records_skipped: tally.skipped,
    records_write_failed: tally.write_failed,
    sidecars_written: sidecarsWritten,
    approx_bytes_reclaimed: approxBytesReclaimed,
    graph_records_sidecarized: graphRecordsSidecarized,
    graph_sidecar_updates: graphSidecarUpdates,
    graph_approx_bytes_reclaimed: graphApproxBytesReclaimed,
    missing_requested_record_ids: missingRequestedIds,
    partial_write: WORK_RECORD_DERIVED_EVIDENCE_CLEANUP_ALL_PARTIAL_WRITE_POLICY,
    skipped,
    per_record: compactPerRecord
  };

  const diagnostics = [];
  for (const entry of perRecord) {
    if (entry.status === "skipped" || entry.status === "refused" || entry.status === "write_failed") {
      for (const diagnostic of entry.diagnostics || []) {
        diagnostics.push({ ...diagnostic, record_id: entry.record_id });
      }
    }
  }

  const valid = tally.refused === 0 && tally.skipped === 0 && tally.write_failed === 0;

  return {
    dir: targetDir,
    write: Boolean(write),
    written: tally.changed > 0,
    valid,
    invalid_request: false,
    report,
    diagnostics
  };
}
