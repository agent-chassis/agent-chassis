

import {
  isObject,
  normalizeNonEmptyString,
  parseDispatchUnitAddress
} from "./work-records-shared.mjs";
import { persistWorkRecordGraphImpactByUnit } from "./work-records-graph-impact.mjs";
import { getCommittedHeadGraphImpactPaths } from "../lib/sidecar-graph-impact.mjs";
import {
  rebuildGraphIndexAtHead,
  SidecarGraphIndexUnbuildableError
} from "../lib/sidecar-graph-impact-artifact.mjs";
import { SIDECAR_GRAPH_SCHEMA_VERSION } from "../lib/sidecar-graph-schema.mjs";
import { validateImpactPath } from "../lib/sidecar-graph-impact-shared.mjs";
import { loadWorkRecordById } from "../lib/work-record-store.mjs";
import { computeReviewedUnitSourceDigest } from "../lib/work-record-review-attestation.mjs";

const SCHEMA_VERSION = "graph-impact-generate.v1";

function createGenerateResult(overrides = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    outcome: "not_persisted",
    record_id: null,
    unit: null,
    paths_source: null,
    subject_paths: [],
    graph_bearing_paths: [],
    written: false,
    valid: false,
    graph_available: false,
    staleness: null,
    dirty_state: null,
    source_digest: null,
    selected_unit: null,
    graph_state: null,

    graph_impact_envelope: null,
    diagnostics: [],
    persist_result: null,
    ...overrides
  };
}

function normalizePaths(paths) {
  if (!Array.isArray(paths)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  for (const value of paths) {
    const validation = validateImpactPath(value);
    const entry = validation.ok ? validation.relative_path : null;
    if (!entry || seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    normalized.push(entry);
  }
  return normalized.sort((left, right) => left.localeCompare(right));
}

function canonicalSubjectPaths(subject) {
  return normalizePaths([
    ...(Array.isArray(subject?.write_scope) ? subject.write_scope : []),
    ...(Array.isArray(subject?.repo_paths) ? subject.repo_paths : [])
  ]);
}

function samePaths(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function resolveSubjectForUnit(record, parsedUnit) {
  if (parsedUnit.unit.kind !== "slice") {
    return { subject: record, missingSlice: null };
  }
  const slices = Array.isArray(record?.slices) ? record.slices : [];
  const selectedSlice =
    slices.find((entry) => isObject(entry) && entry.id === parsedUnit.unit.slice_id) || null;
  if (!selectedSlice) {
    return { subject: null, missingSlice: parsedUnit.unit.slice_id };
  }
  return { subject: selectedSlice, missingSlice: null };
}

export async function generateAndPersistWorkRecordGraphImpactByUnit({
  dir = ".",
  unitAddress,
  paths = null,
  cacheDir = undefined,
  recordStore = null
} = {}) {
  const parsedUnit = parseDispatchUnitAddress(unitAddress);
  if (!parsedUnit.ok) {
    return createGenerateResult({
      outcome: "invalid_unit",
      diagnostics: [
        {
          code: parsedUnit.error.code,
          severity: "error",
          message: parsedUnit.error.message,
          path: parsedUnit.error.path
        }
      ]
    });
  }

  const recordId = parsedUnit.recordId;
  const unit = parsedUnit.unit;

  const pathsProvided = paths !== null && paths !== undefined;
  const explicitPaths = normalizePaths(paths);
  let subject = null;
  const pathsSource = pathsProvided ? "explicit" : "derived";

  const loaded = await loadWorkRecordById({ dir, id: recordId, recordStore });
  if (!loaded.record) {
    return createGenerateResult({
      outcome: "record_not_found",
      record_id: recordId,
      unit,
      paths_source: pathsSource,
      diagnostics: Array.isArray(loaded.diagnostics) ? loaded.diagnostics : []
    });
  }
  const resolved = resolveSubjectForUnit(loaded.record, parsedUnit);
  if (resolved.missingSlice) {
    return createGenerateResult({
      outcome: "missing_slice",
      record_id: recordId,
      unit,
      paths_source: pathsSource,
      diagnostics: [
        {
          code: "invalid_record",
          severity: "error",
          message: `Selected slice ${resolved.missingSlice} does not exist on ${recordId}`,
          path: "unit"
        }
      ]
    });
  }
  subject = resolved.subject;
  const initialReviewedUnitDigest = computeReviewedUnitSourceDigest(
    unit.kind === "slice"
      ? { record: loaded.record, selected_slice_id: unit.slice_id }
      : loaded.record
  );
  if (!initialReviewedUnitDigest) {
    return createGenerateResult({
      outcome: "invalid_record",
      record_id: recordId,
      unit,
      paths_source: pathsSource,
      diagnostics: [{ code: "invalid_record", severity: "error", message: `Could not resolve reviewed-unit digest for ${unit.address}`, path: "unit" }]
    });
  }
  const canonicalPaths = canonicalSubjectPaths(subject);
  if (pathsProvided && !samePaths(explicitPaths, canonicalPaths)) {
    return createGenerateResult({
      outcome: "explicit_paths_mismatch",
      record_id: recordId,
      unit,
      selected_unit: unit,
      paths_source: pathsSource,
      subject_paths: canonicalPaths,
      diagnostics: [
        {
          code: "explicit_paths_mismatch",
          severity: "error",
          message: "paths must exactly match the selected unit's canonical write_scope/repo_paths projection",
          path: "paths"
        }
      ]
    });
  }

  let queryEnvelope = {
    ...(await getCommittedHeadGraphImpactPaths({ dir, selectedUnit: unit, subject, cacheDir })),
    source_record_digest: initialReviewedUnitDigest
  };
  if (
    !queryEnvelope.available &&
    [
      "base_artifact_unavailable",
      "base_artifact_corrupt",
      "base_artifact_incompatible"
    ].includes(queryEnvelope.outcome)
  ) {
    try {
      await rebuildGraphIndexAtHead({ targetDir: dir, cacheDir });
      queryEnvelope = {
        ...(await getCommittedHeadGraphImpactPaths({ dir, selectedUnit: unit, subject, cacheDir })),
        source_record_digest: initialReviewedUnitDigest
      };
    } catch (error) {
      if (!(error instanceof SidecarGraphIndexUnbuildableError)) throw error;
      queryEnvelope = { ...queryEnvelope, outcome: error.code };
    }
  }
  const subjectPaths = queryEnvelope.projection?.subject_paths ?? [];
  const graphBearingPaths = queryEnvelope.projection?.graph_bearing_paths ?? [];
  if (queryEnvelope.available && graphBearingPaths.length === 0) {
    return createGenerateResult({
      outcome: "no_graph_bearing_paths",
      record_id: recordId,
      unit,
      paths_source: pathsSource,
      subject_paths: subjectPaths,
      graph_bearing_paths: graphBearingPaths,
      diagnostics: [
        {
          code: "no_graph_bearing_paths",
          severity: "warning",
          message:
            subjectPaths.length === 0
              ? "no subject paths to analyze for graph impact (empty write_scope/repo_paths)"
              : "no graph-bearing subject paths to analyze (all paths are non-graph-bearing wrappers)",
          path: pathsSource === "explicit" ? "paths" : "write_scope"
        }
      ]
    });
  }

  if (!queryEnvelope.available) {
    return createGenerateResult({
      outcome: "graph_head_unbuildable",
      record_id: recordId,
      unit,
      paths_source: pathsSource,
      subject_paths: subjectPaths,
      graph_bearing_paths: graphBearingPaths,
      graph_available: false,
      diagnostics: [
        {
          code: queryEnvelope.outcome,
          severity: "error",
          message: "the exact committed-HEAD graph artifact is unavailable or incompatible",
          path: pathsSource === "explicit" ? "paths" : "write_scope"
        }
      ]
    });
  }

  const graphState = isObject(queryEnvelope.graph_state) ? queryEnvelope.graph_state : {};
  const graphAvailable = graphState.graph_available === true;
  const graphSchemaVersion = normalizeNonEmptyString(graphState.graph_schema_version);
  const staleness = normalizeNonEmptyString(queryEnvelope.staleness ?? graphState.staleness);
  const dirtyState = normalizeNonEmptyString(queryEnvelope.dirty_state ?? graphState.dirty_state);

  const persistResult = await persistWorkRecordGraphImpactByUnit({
    dir,
    unitAddress,
    graphImpact: queryEnvelope,
    recordStore
  });

  const written = persistResult.written === true;
  const graphUnavailable = !graphAvailable || graphSchemaVersion !== SIDECAR_GRAPH_SCHEMA_VERSION;
  const selectedUnitRefused =
    !written &&
    (persistResult.diagnostics ?? []).some((entry) =>
      ["stale_source_digest", "invalid_record", "missing_json_record", "invalid_json"].includes(entry?.code)
    );

  let outcome;
  if (written) {

    outcome =
      graphAvailable && staleness === "fresh"
        ? "persisted"
        : "degraded_persisted";
  } else if (graphUnavailable) {

    outcome = "graph_unavailable";
  } else {

    outcome = "not_persisted";
  }

  const selectedUnit = persistResult.selected_unit ?? unit;
  const graphImpactEnvelope =
    graphAvailable && !graphUnavailable && !selectedUnitRefused
      ? {
          ...queryEnvelope,
          record_id: persistResult.record_id ?? recordId,
          slice_id: unit.kind === "slice" ? unit.slice_id : null,
          unit: {
            kind: unit.kind,
            record_id: persistResult.record_id ?? recordId,
            ...(unit.kind === "slice" ? { slice_id: unit.slice_id } : {})
          },
          source_record_digest: persistResult.source_digest ?? null
        }
      : null;

  return createGenerateResult({
    outcome,
    record_id: persistResult.record_id ?? recordId,
    unit,
    paths_source: pathsSource,
    subject_paths: subjectPaths,
    graph_bearing_paths: graphBearingPaths,
    written,
    valid: persistResult.valid === true,
    graph_available: graphAvailable,
    staleness,
    dirty_state: dirtyState,
    source_digest: persistResult.source_digest ?? null,
    selected_unit: selectedUnit,
    graph_state: graphState,
    graph_impact_envelope: graphImpactEnvelope,
    diagnostics: Array.isArray(persistResult.diagnostics) ? persistResult.diagnostics : [],
    persist_result: persistResult
  });
}
