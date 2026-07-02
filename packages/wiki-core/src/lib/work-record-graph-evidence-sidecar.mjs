

import { createHash } from "node:crypto";
import {
  cloneJson,
  computeNormalizedInputDigest,
  isNonEmptyString,
  isObject,
  normalizeStringEntry,
  toNonNegativeInteger
} from "./work-record-admission-shared.mjs";
import { createWorkRecordGraphImpactSummary } from "./work-record-graph-impact-summary.mjs";

export const WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_SCHEMA_VERSION =
  "work-record-graph-evidence-sidecar.v1";
export const WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_KIND =
  "work_record_graph_evidence_sidecar";
export const WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_DIRECTORY =
  "wiki/work-records/evidence";
export const WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_GENERATOR = {
  name: "agent-chassis",
  version: "0.2.0"
};

const GRAPH_IMPACT_REFERENCE_KIND = "graph_impact_reference";
export const WORK_RECORD_GRAPH_INLINE_REF_KIND =
  "work_record_graph_impact_inline_ref";

export function graphEvidenceSidecarPathForRecord(recordId) {
  const normalized = normalizeStringEntry(recordId);
  if (!normalized) {
    throw new Error("graphEvidenceSidecarPathForRecord requires a non-empty record id");
  }
  if (/[\\/]/u.test(normalized) || normalized.includes("..")) {
    throw new Error(`graphEvidenceSidecarPathForRecord: unsafe record id "${normalized}"`);
  }
  return `${WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_DIRECTORY}/${normalized}.graph.json`;
}

export function serializeGraphEvidenceSidecar(sidecar) {
  return `${JSON.stringify(sidecar, null, 2)}\n`;
}

export function computeGraphEvidenceSidecarDigest(sidecar) {
  return `sha256:${createHash("sha256")
    .update(serializeGraphEvidenceSidecar(sidecar), "utf8")
    .digest("hex")}`;
}

export function computeGraphEvidenceEntryDigest(entry) {
  const clone = cloneJson(entry) ?? {};
  delete clone.graph_entry_digest;
  return computeNormalizedInputDigest(clone);
}

function normalizeSidecarUnit(value) {
  if (!isObject(value)) {
    return null;
  }
  const address = normalizeStringEntry(value.address);
  const recordId =
    normalizeStringEntry(value.record_id) ??
    (address && address.includes("#") ? normalizeStringEntry(address.split("#")[0]) : address);
  if (!recordId) {
    return null;
  }

  let kind = normalizeStringEntry(value.kind)?.toLowerCase();
  let sliceId = normalizeStringEntry(value.slice_id);
  if (!kind) {
    kind = sliceId ? "slice" : "work_item";
  }

  if (kind === "slice") {
    if (!sliceId && address && address.includes("#")) {
      sliceId = normalizeStringEntry(address.split("#")[1]);
    }

    if (!sliceId) {
      throw new Error(
        "graph sidecar slice unit requires a non-empty string unit.slice_id"
      );
    }
  } else {
    sliceId = null;
  }

  const resolvedAddress =
    address ?? (kind === "slice" ? `${recordId}#${sliceId}` : recordId);

  return {
    kind,
    address: resolvedAddress,
    record_id: recordId,
    slice_id: kind === "slice" ? sliceId : null
  };
}

function collectStringList(value) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(value) ? value : []) {
    const normalized = normalizeStringEntry(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function firstNonEmptyField(sources, fields) {
  for (const source of sources) {
    if (!isObject(source)) {
      continue;
    }
    for (const field of fields) {
      const value = normalizeStringEntry(source[field]);
      if (value) {
        return value;
      }
    }
  }
  return null;
}

function buildReadinessProjection({ graphImpact, summary, summaryRef }) {
  const graphState = isObject(summary?.graph_state) ? summary.graph_state : {};
  const graph_state = {
    graph_available: Boolean(graphState.graph_available),
    dirty_state: normalizeStringEntry(graphState.dirty_state) ?? "unknown",
    staleness: normalizeStringEntry(graphState.staleness) ?? "unknown",
    edge_source: normalizeStringEntry(graphState.edge_source) ?? "unavailable",
    dirty_graph_mode: normalizeStringEntry(graphState.dirty_graph_mode) ?? "unavailable",
    graph_schema_version: normalizeStringEntry(graphState.graph_schema_version) ?? null,
    unavailable_path_count: toNonNegativeInteger(graphState.unavailable_path_count) ?? 0
  };

  const input_paths = collectStringList(graphImpact?.input_paths ?? summaryRef?.input_paths);
  const validated_paths = collectStringList(
    graphImpact?.validated_paths ?? summaryRef?.validated_paths
  );
  const invalid_path_count = Array.isArray(graphImpact?.invalid_paths)
    ? graphImpact.invalid_paths.length
    : toNonNegativeInteger(summary?.counts?.invalid_paths) ??
      toNonNegativeInteger(summaryRef?.invalid_path_count) ??
      0;

  const counts = isObject(summary?.counts) ? cloneJson(summary.counts) : {};
  const degraded_state = isObject(summary?.graph_quality?.degraded_state)
    ? cloneJson(summary.graph_quality.degraded_state)
    : null;

  return { graph_state, input_paths, validated_paths, invalid_path_count, counts, degraded_state };
}

function buildSummaryRef({
  sourceRef,
  summary,
  sourceRecordDigest,
  bindingToken,
  rawEvidenceDigest,
  embedSummary,
  inputPaths,
  validatedPaths
}) {
  const ref = { kind: GRAPH_IMPACT_REFERENCE_KIND };
  if (sourceRecordDigest) {
    ref.source_record_digest = sourceRecordDigest;
  }
  if (bindingToken) {
    ref.binding_token = bindingToken;
  }
  if (rawEvidenceDigest) {
    ref.raw_evidence_digest = rawEvidenceDigest;
  }
  const rawEvidenceRef = normalizeStringEntry(sourceRef?.raw_evidence_ref);
  if (rawEvidenceRef) {
    ref.raw_evidence_ref = rawEvidenceRef;
  }
  if (embedSummary && summary) {

    ref.summary = cloneJson(summary);
  } else {

    if (inputPaths.length > 0) {
      ref.input_paths = cloneJson(inputPaths);
    }
    if (validatedPaths.length > 0) {
      ref.validated_paths = cloneJson(validatedPaths);
    }
  }
  return ref;
}

function normalizeEntryTimestamp(value) {
  if (isNonEmptyString(value)) {
    return String(value).trim();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return new Date().toISOString();
}

export function buildGraphEvidenceSidecarEntry(input = {}) {
  const unit = normalizeSidecarUnit(input.unit);
  if (!unit) {
    throw new Error("buildGraphEvidenceSidecarEntry requires a resolvable unit");
  }

  const graphImpact = isObject(input.graph_impact ?? input.graphImpact)
    ? (input.graph_impact ?? input.graphImpact)
    : null;
  const providedSummary = isObject(input.graph_impact_summary ?? input.graphImpactSummary)
    ? (input.graph_impact_summary ?? input.graphImpactSummary)
    : null;
  const summaryRef = isObject(input.graph_impact_summary_ref ?? input.graphImpactSummaryRef)
    ? (input.graph_impact_summary_ref ?? input.graphImpactSummaryRef)
    : null;

  if (!graphImpact && !providedSummary && !summaryRef) {
    throw new Error(
      "buildGraphEvidenceSidecarEntry requires graph_impact, graph_impact_summary, or graph_impact_summary_ref"
    );
  }

  const replayDetailAvailable =
    typeof input.replay_detail_available === "boolean"
      ? input.replay_detail_available
      : Boolean(graphImpact);

  const summary =
    providedSummary ?? (graphImpact ? createWorkRecordGraphImpactSummary(graphImpact, { unit }) : null);
  const readiness = buildReadinessProjection({ graphImpact, summary, summaryRef });
  const rawEvidenceDigest = firstNonEmptyField([summaryRef, graphImpact, summary], [
    "raw_evidence_digest"
  ]);
  const bindingToken = firstNonEmptyField([summaryRef, graphImpact, summary], ["binding_token"]);

  const sourceRecordDigest =
    normalizeStringEntry(input.source_record_digest ?? input.sourceRecordDigest) ??
    normalizeStringEntry(graphImpact?.source_record_digest) ??
    normalizeStringEntry(summary?.source_record_digest) ??
    normalizeStringEntry(summaryRef?.source_record_digest) ??
    null;

  const entry = {
    unit,
    replay_detail_available: replayDetailAvailable,
    query_kind:
      normalizeStringEntry(input.query_kind) ??
      normalizeStringEntry(graphImpact?.query_kind) ??
      normalizeStringEntry(summary?.query_kind) ??
      null,
    source_record_digest: sourceRecordDigest,
    generated_at: normalizeEntryTimestamp(input.generated_at ?? input.generatedAt ?? graphImpact?.generated_at),
    graph_state: readiness.graph_state,
    input_paths: readiness.input_paths,
    validated_paths: readiness.validated_paths,
    invalid_path_count: readiness.invalid_path_count,
    counts: readiness.counts,
    degraded_state: readiness.degraded_state,
    raw_evidence_digest: rawEvidenceDigest,
    binding_token: bindingToken
  };

  if (replayDetailAvailable) {
    if (graphImpact) {
      entry.graph_impact = cloneJson(graphImpact);
    }
    if (summary) {
      entry.graph_impact_summary = cloneJson(summary);
    }
    entry.graph_impact_summary_ref = buildSummaryRef({
      sourceRef: summaryRef,
      summary,
      sourceRecordDigest,
      bindingToken,
      rawEvidenceDigest,
      embedSummary: true,
      inputPaths: readiness.input_paths,
      validatedPaths: readiness.validated_paths
    });
  } else {
    if (summary) {

      entry.graph_impact_summary = cloneJson(summary);
    }
    entry.graph_impact_summary_ref = buildSummaryRef({
      sourceRef: summaryRef,
      summary,
      sourceRecordDigest,
      bindingToken,
      rawEvidenceDigest,
      embedSummary: false,
      inputPaths: readiness.input_paths,
      validatedPaths: readiness.validated_paths
    });
  }

  entry.graph_entry_digest = computeGraphEvidenceEntryDigest(entry);
  return entry;
}

export function createGraphEvidenceSidecar(recordId, { generatedAt, updatedAt } = {}) {
  const normalizedRecordId = normalizeStringEntry(recordId);
  if (!normalizedRecordId) {
    throw new Error("createGraphEvidenceSidecar requires a non-empty record id");
  }
  const generated = normalizeEntryTimestamp(generatedAt);
  return {
    schema_version: WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_SCHEMA_VERSION,
    kind: WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_KIND,
    record_id: normalizedRecordId,
    generator: { ...WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_GENERATOR },
    generated_at: generated,
    updated_at: normalizeEntryTimestamp(updatedAt ?? generatedAt ?? generated),
    record: null,
    slices: {}
  };
}

export function validateGraphEvidenceSidecar(value, { recordId } = {}) {
  const diagnostics = [];
  if (!isObject(value)) {
    return [{ code: "graph_sidecar_not_object", message: "graph sidecar must be an object" }];
  }
  if (normalizeStringEntry(value.schema_version) !== WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_SCHEMA_VERSION) {
    diagnostics.push({
      code: "graph_sidecar_schema_version_unsupported",
      message: `graph sidecar schema_version must be ${WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_SCHEMA_VERSION}`,
      value: value.schema_version ?? null
    });
  }
  const resolvedRecordId = normalizeStringEntry(value.record_id);
  if (!resolvedRecordId) {
    diagnostics.push({ code: "graph_sidecar_record_id_missing", message: "graph sidecar requires record_id" });
  }
  const expectedRecordId = normalizeStringEntry(recordId);
  if (expectedRecordId && resolvedRecordId && expectedRecordId !== resolvedRecordId) {
    diagnostics.push({
      code: "graph_sidecar_record_id_mismatch",
      message: `graph sidecar record_id ${resolvedRecordId} does not match expected ${expectedRecordId}`
    });
  }
  if (value.record !== null && value.record !== undefined && !isObject(value.record)) {
    diagnostics.push({ code: "graph_sidecar_record_entry_invalid", message: "graph sidecar record entry must be an object or null" });
  }
  if (isObject(value.record) && value.record.unit?.kind === "slice") {
    diagnostics.push({
      code: "graph_sidecar_record_entry_is_slice",
      message: "record-level graph evidence must not be a slice unit"
    });
  }
  const slices = value.slices;
  if (slices !== undefined && !isObject(slices)) {
    diagnostics.push({ code: "graph_sidecar_slices_invalid", message: "graph sidecar slices must be an object map" });
  } else if (isObject(slices)) {
    for (const [key, entry] of Object.entries(slices)) {
      if (!isNonEmptyString(key)) {
        diagnostics.push({ code: "graph_sidecar_slice_key_invalid", message: "graph sidecar slice keys must be non-empty strings", key });
        continue;
      }
      if (!isObject(entry)) {
        diagnostics.push({ code: "graph_sidecar_slice_entry_invalid", message: `graph sidecar slice entry ${key} must be an object`, key });
        continue;
      }
      const entrySliceId = normalizeStringEntry(entry.unit?.slice_id);
      if (entrySliceId && entrySliceId !== key) {
        diagnostics.push({
          code: "graph_sidecar_slice_key_address_mismatch",
          message: `graph sidecar slice key ${key} disagrees with entry unit.slice_id ${entrySliceId}`,
          key
        });
      }
    }
  }
  return diagnostics;
}

export function normalizeGraphEvidenceSidecar(value, { recordId } = {}) {
  const diagnostics = validateGraphEvidenceSidecar(value, { recordId });
  if (diagnostics.length > 0) {
    const detail = diagnostics.map((entry) => entry.code).join(", ");
    throw new Error(`normalizeGraphEvidenceSidecar: invalid graph sidecar (${detail})`);
  }
  const normalized = cloneJson(value);
  normalized.kind = WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_KIND;
  if (!isObject(normalized.generator)) {
    normalized.generator = { ...WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_GENERATOR };
  }
  if (normalized.record === undefined) {
    normalized.record = null;
  }
  if (!isObject(normalized.slices)) {
    normalized.slices = {};
  }
  return normalized;
}

export function detectGraphEvidenceSidecarSliceKeyCollisions(entries) {
  const byKey = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
    const sliceId = normalizeStringEntry(entry?.unit?.slice_id);
    if (!sliceId || entry?.unit?.kind !== "slice") {
      return;
    }
    const group = byKey.get(sliceId) ?? [];
    group.push({ index, address: normalizeStringEntry(entry?.unit?.address) ?? null });
    byKey.set(sliceId, group);
  });

  const collisions = [];
  for (const [sliceId, group] of byKey) {
    if (group.length <= 1) {
      continue;
    }
    collisions.push({
      slice_id: sliceId,
      count: group.length,
      addresses: group.map((member) => member.address),
      indices: group.map((member) => member.index)
    });
  }
  collisions.sort((left, right) => String(left.slice_id).localeCompare(String(right.slice_id)));
  return collisions;
}

export function upsertGraphEvidenceSidecarEntry(sidecar, entry, { updatedAt } = {}) {
  const next = normalizeGraphEvidenceSidecar(sidecar);
  if (!isObject(entry) || !isObject(entry.unit)) {
    throw new Error("upsertGraphEvidenceSidecarEntry requires an entry with a unit");
  }
  const unit = entry.unit;
  const clonedEntry = cloneJson(entry);

  if (unit.kind === "slice" || normalizeStringEntry(unit.slice_id)) {
    const sliceId = normalizeStringEntry(unit.slice_id);
    if (!sliceId) {
      throw new Error("upsertGraphEvidenceSidecarEntry: slice entry requires a non-empty unit.slice_id");
    }
    const existing = next.slices[sliceId];
    if (
      isObject(existing) &&
      normalizeStringEntry(existing.unit?.address) !== normalizeStringEntry(unit.address)
    ) {
      throw new Error(
        `upsertGraphEvidenceSidecarEntry: slice key ${sliceId} collision; existing address ` +
          `${normalizeStringEntry(existing.unit?.address)} != ${normalizeStringEntry(unit.address)}`
      );
    }
    next.slices[sliceId] = clonedEntry;
  } else {
    next.record = clonedEntry;
  }

  next.updated_at = normalizeEntryTimestamp(updatedAt);
  return next;
}

export function buildGraphEvidenceSidecarFromEntries({
  recordId,
  recordEntry = null,
  sliceEntries = [],
  generatedAt,
  updatedAt
} = {}) {
  const entries = Array.isArray(sliceEntries) ? sliceEntries : [];
  const collisions = detectGraphEvidenceSidecarSliceKeyCollisions(entries);
  if (collisions.length > 0) {
    const detail = collisions.map((collision) => collision.slice_id).join(", ");
    throw new Error(`buildGraphEvidenceSidecarFromEntries: duplicate slice keys (${detail})`);
  }

  const resolvedRecordId =
    normalizeStringEntry(recordId) ??
    normalizeStringEntry(recordEntry?.unit?.record_id) ??
    normalizeStringEntry(entries[0]?.unit?.record_id);

  const sidecar = createGraphEvidenceSidecar(resolvedRecordId, { generatedAt, updatedAt });

  if (recordEntry) {
    if (recordEntry.unit?.kind === "slice") {
      throw new Error("buildGraphEvidenceSidecarFromEntries: record entry must not be a slice unit");
    }
    sidecar.record = cloneJson(recordEntry);
  }

  for (const entry of entries) {
    const sliceId = normalizeStringEntry(entry?.unit?.slice_id);
    if (!sliceId || entry?.unit?.kind !== "slice") {
      throw new Error("buildGraphEvidenceSidecarFromEntries: every slice entry requires a slice unit with a slice_id");
    }
    sidecar.slices[sliceId] = cloneJson(entry);
  }

  sidecar.updated_at = normalizeEntryTimestamp(updatedAt ?? generatedAt ?? sidecar.generated_at);
  return sidecar;
}

export function resolveGraphEvidenceSidecarEntry(sidecar, unit) {
  if (!isObject(sidecar)) {
    return null;
  }
  const normalizedUnit = isObject(unit) ? unit : {};
  const sliceId = normalizeStringEntry(normalizedUnit.slice_id);
  if (normalizedUnit.kind === "slice" || sliceId) {
    if (!sliceId) {
      return null;
    }
    return isObject(sidecar.slices) ? sidecar.slices[sliceId] ?? null : null;
  }
  return isObject(sidecar.record) ? sidecar.record : null;
}

export function buildCompactInlineGraphEvidenceRef(entry, { sidecarPath, sidecarDigest } = {}) {
  if (!isObject(entry) || !isObject(entry.unit)) {
    throw new Error("buildCompactInlineGraphEvidenceRef requires an entry with a unit");
  }
  const unit = entry.unit;
  const ref = {
    kind: WORK_RECORD_GRAPH_INLINE_REF_KIND,
    unit: cloneJson(unit),
    record_id: normalizeStringEntry(unit.record_id) ?? null,
    replay_detail_available: entry.replay_detail_available === true,
    query_kind: normalizeStringEntry(entry.query_kind) ?? null,
    source_record_digest: normalizeStringEntry(entry.source_record_digest) ?? null,
    graph_state: cloneJson(entry.graph_state) ?? null,
    input_paths: cloneJson(entry.input_paths) ?? [],
    validated_paths: cloneJson(entry.validated_paths) ?? [],
    invalid_path_count: toNonNegativeInteger(entry.invalid_path_count) ?? 0,
    counts: cloneJson(entry.counts) ?? {},
    degraded_state: cloneJson(entry.degraded_state) ?? null,
    raw_evidence_digest: normalizeStringEntry(entry.raw_evidence_digest) ?? null,
    binding_token: normalizeStringEntry(entry.binding_token) ?? null,
    sidecar_path: normalizeStringEntry(sidecarPath) ?? null,
    graph_sidecar_digest: normalizeStringEntry(sidecarDigest) ?? null,
    graph_entry_digest: normalizeStringEntry(entry.graph_entry_digest) ?? null
  };
  if (unit.kind === "slice") {
    ref.slice_id = normalizeStringEntry(unit.slice_id) ?? null;
  } else {
    ref.record_entry = true;
  }
  return ref;
}

export function verifyGraphSidecarEntryForInlineRef(sidecar, inlineRef) {
  const diagnostics = [];
  if (!isObject(inlineRef) || !isObject(inlineRef.unit)) {
    return { ok: false, diagnostics: [{ code: "graph_inline_ref_invalid", message: "inline ref must carry a unit" }] };
  }
  const entry = resolveGraphEvidenceSidecarEntry(sidecar, inlineRef.unit);
  if (!isObject(entry)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "graph_sidecar_entry_missing",
          message: `graph sidecar has no entry for ${normalizeStringEntry(inlineRef.unit.address) ?? "unit"}`
        }
      ]
    };
  }

  const expectedDigest = normalizeStringEntry(inlineRef.graph_entry_digest);
  const actualDigest = normalizeStringEntry(entry.graph_entry_digest);
  if (!expectedDigest || !actualDigest || expectedDigest !== actualDigest) {
    diagnostics.push({
      code: "graph_entry_digest_mismatch",
      message: "graph sidecar entry digest does not match inline ref",
      expected: expectedDigest,
      actual: actualDigest
    });
  }

  const recomputed = computeGraphEvidenceEntryDigest(entry);
  if (actualDigest && recomputed !== actualDigest) {
    diagnostics.push({
      code: "graph_entry_digest_stale",
      message: "graph sidecar entry digest does not match its content",
      stored: actualDigest,
      recomputed
    });
  }

  if (inlineRef.replay_detail_available === true) {
    if (entry.replay_detail_available !== true || !isObject(entry.graph_impact)) {
      diagnostics.push({
        code: "graph_sidecar_replay_detail_absent",
        message: "inline ref claims full replay detail but the sidecar entry lacks it"
      });
    }
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

function sidecarHeader(sidecar) {
  return {
    schema_version: WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_SCHEMA_VERSION,
    kind: WORK_RECORD_GRAPH_EVIDENCE_SIDECAR_KIND,
    record_id: normalizeStringEntry(sidecar?.record_id) ?? null
  };
}

function compactRecordEntryProjection(record) {
  if (!isObject(record)) {
    return { available: false, replay_detail_available: false, graph_entry_digest: null };
  }
  return {
    available: true,
    replay_detail_available: record.replay_detail_available === true,
    graph_entry_digest: normalizeStringEntry(record.graph_entry_digest) ?? null
  };
}

function compactSliceProjection(sliceId, entry) {
  return {
    slice_id: sliceId,
    address: normalizeStringEntry(entry?.unit?.address) ?? null,
    replay_detail_available: entry?.replay_detail_available === true,
    graph_entry_digest: normalizeStringEntry(entry?.graph_entry_digest) ?? null
  };
}

export function projectGraphEvidenceSidecarDefault(sidecar) {
  const source = isObject(sidecar) ? sidecar : {};
  const slices = isObject(source.slices) ? source.slices : {};
  const sliceIds = Object.keys(slices).sort((left, right) => left.localeCompare(right));
  return {
    ...sidecarHeader(source),
    projection: "default",
    generated_at: normalizeStringEntry(source.generated_at) ?? null,
    updated_at: normalizeStringEntry(source.updated_at) ?? null,
    graph_sidecar_digest: isObject(sidecar) ? computeGraphEvidenceSidecarDigest(source) : null,
    record_entry: compactRecordEntryProjection(source.record),
    slice_count: sliceIds.length,
    slice_ids: sliceIds,
    slices: sliceIds.reduce((accumulator, sliceId) => {
      accumulator[sliceId] = compactSliceProjection(sliceId, slices[sliceId]);
      return accumulator;
    }, {})
  };
}

export function projectGraphEvidenceSidecarSelectedSlice(sidecar, sliceId) {
  const source = isObject(sidecar) ? sidecar : {};
  const slices = isObject(source.slices) ? source.slices : {};
  const key = normalizeStringEntry(sliceId);
  const entry = key ? slices[key] ?? null : null;
  const projection = {
    ...sidecarHeader(source),
    projection: "selected_slice",
    selected_slice: key,
    found: isObject(entry),
    slice: isObject(entry) ? cloneJson(entry) : null
  };
  if (!isObject(entry)) {
    projection.diagnostics = [
      { code: "graph_sidecar_slice_not_found", message: `graph sidecar has no slice entry ${key ?? "(missing slice id)"}`, slice_id: key }
    ];
  }
  return projection;
}

export function projectGraphEvidenceSidecarSelectedRecord(sidecar) {
  const source = isObject(sidecar) ? sidecar : {};
  const record = isObject(source.record) ? source.record : null;
  const projection = {
    ...sidecarHeader(source),
    projection: "selected_record",
    selected_record: true,
    found: Boolean(record),
    record: record ? cloneJson(record) : null
  };
  if (!record) {
    projection.diagnostics = [
      { code: "graph_sidecar_record_entry_absent", message: "graph sidecar has no record-level entry" }
    ];
  }
  return projection;
}

export function projectGraphEvidenceSidecarFull(sidecar) {
  return isObject(sidecar) ? cloneJson(sidecar) : null;
}

export function projectGraphEvidenceSidecar(sidecar, options = {}) {
  const selectedSlice = normalizeStringEntry(options.selected_slice ?? options.selectedSlice);
  const selectedRecord = options.selected_record === true || options.selectedRecord === true;
  if (selectedSlice && selectedRecord) {
    throw new Error("projectGraphEvidenceSidecar: selected_slice and selected_record are mutually exclusive");
  }
  if (selectedSlice) {
    return projectGraphEvidenceSidecarSelectedSlice(sidecar, selectedSlice);
  }
  if (selectedRecord) {
    return projectGraphEvidenceSidecarSelectedRecord(sidecar);
  }
  if (options.verbose === true || options.include_record === true || options.includeRecord === true) {
    return projectGraphEvidenceSidecarFull(sidecar);
  }
  return projectGraphEvidenceSidecarDefault(sidecar);
}
