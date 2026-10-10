

import { normalizeAdvisoryDispositions, validateWorkRecordDispositions } from "../lib/review-disposition.mjs";
import { computeWorkRecordSourceDigest } from "../lib/work-record-schema.mjs";
import { loadWorkRecordById } from "../lib/work-record-store.mjs";

const CAPTURED_FINDINGS_SOURCE_KIND = "original_managed_findings";
const refusal = (code, path, message) => ({ ok: false, diagnostics: [{ code, severity: "error", path, message }] });
const selectUnit = (record, sliceId) => sliceId === null ? record
  : record.slices?.find((slice) => slice.id === sliceId) ?? null;

function capturedFindings(unit, entryId, versionId) {
  const entry = unit.sections?.entries?.find((candidate) => candidate.id === entryId);
  const version = entry?.versions.find((candidate) => candidate.id === (versionId ?? entry.current_version));
  const sources = version?.provenance?.sources;
  if (version === undefined || !Array.isArray(sources) || sources.length !== 1 ||
      sources[0]?.source_kind !== CAPTURED_FINDINGS_SOURCE_KIND || typeof sources[0].run_id !== "string" ||
      typeof version.content?.text !== "string") return null;
  return { entry_id: entry.id, version_id: version.id, run_id: sources[0].run_id,
    findings: Array.isArray(sources[0].findings) ? sources[0].findings : [], text: version.content.text };
}

function selectExtent(captured, { text, occurrence }, path) {
  const haystack = Array.from(captured.text);
  const needle = Array.from(text);
  const offsets = [];
  for (let at = 0; at + needle.length <= haystack.length; at += 1) {
    if (needle.every((point, index) => haystack[at + index] === point)) offsets.push(at);
  }
  if (offsets.length === 0) return refusal("work_record_disposition_selection_not_found", `${path}.selected_text`,
    "the selected text does not occur in the captured entry version");
  if (occurrence === undefined && offsets.length > 1) return refusal("work_record_disposition_selection_ambiguous",
    `${path}.selected_text`, `the selected text occurs ${offsets.length} times; name its zero-based occurrence`);
  if ((occurrence ?? 0) >= offsets.length) return refusal("work_record_disposition_selection_not_found",
    `${path}.selected_text.occurrence`, `the selected text occurs ${offsets.length} times`);
  return { ok: true, selection: { offset: offsets[occurrence ?? 0], length: needle.length } };
}

const occurrenceKey = (row) => JSON.stringify([row.entry.entry_id, row.entry.version_id, row.selection]);

function validateSavedSources(unit, rows) {
  const diagnostics = validateWorkRecordDispositions(rows);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  for (const [index, row] of rows.entries()) {
    const path = `sections.dispositions[${index}]`;
    const captured = capturedFindings(unit, row.entry.entry_id, row.entry.version_id);
    if (captured === null) return refusal("work_record_disposition_source_not_review_material", `${path}.entry`,
      "the named entry version is not an immutable capture of authenticated review findings on this unit");
    if (row.review_run_id !== captured.run_id) return refusal("work_record_disposition_review_run_mismatch",
      `${path}.review_run_id`, "the saved producer run differs from the exact captured entry version's run");
    if (row.selection.finding_id !== undefined) {
      const normalized = normalizeAdvisoryDispositions([{ review_run_id: row.review_run_id,
        finding_id: row.selection.finding_id, disposition: row.disposition }],
      { reviews: [{ run_id: captured.run_id, findings: captured.findings }] });
      if (normalized === null) return refusal("work_record_disposition_finding_unknown", `${path}.selection.finding_id`,
        "the captured run lists no producer finding with this id");
    } else {
      const scalars = Array.from(captured.text).length;
      if (row.selection.offset > scalars || row.selection.length > scalars - row.selection.offset) {
        return refusal("work_record_disposition_selection_out_of_bounds", `${path}.selection`,
          "the saved Unicode-scalar extent lies outside the exact captured entry version's text");
      }
    }
  }
  return { ok: true };
}

export function planWorkRecordDispositions({ record, sliceId = null, rows, resolveEntry = (value) => value,
  bind = () => {} }) {
  const updated = structuredClone(record);
  const unit = selectUnit(updated, sliceId);
  const saved = Array.isArray(unit.sections?.dispositions) ? unit.sections.dispositions : [];
  const next = structuredClone(saved);
  let nextId = saved.reduce((highest, row) => Math.max(highest, row.id), 0);
  const touched = new Set();
  for (const [index, row] of rows.entries()) {
    const path = `changes.dispositions[${index}]`;
    if (row.id !== undefined) {
      const existing = next.find((candidate) => candidate.id === row.id);
      if (existing === undefined) return refusal("record_authoring_row_unknown", `${path}.id`,
        `${path}.id names a disposition the selected unit does not have; a new judgment carries key`);
      if (row.entry !== undefined || row.finding_id !== undefined || row.selected_text !== undefined) {
        return refusal("work_record_disposition_source_immutable", path,
          "an existing judgment keeps its source; change its disposition or rationale, or author a new judgment");
      }

      if (touched.has(occurrenceKey(existing))) return refusal("work_record_disposition_occurrence_duplicate", path,
        "this occurrence is already judged in this batch; state its judgment once");
      if (row.disposition !== undefined) existing.disposition = row.disposition;
      if (row.rationale !== undefined) existing.rationale = row.rationale;
      touched.add(occurrenceKey(existing));
      continue;
    }
    if (row.entry === undefined || row.disposition === undefined ||
        (row.finding_id === undefined) === (row.selected_text === undefined)) {
      return refusal("work_record_disposition_invalid", path,
        "a new judgment names its captured entry, exactly one of finding_id or selected_text, and a disposition");
    }
    const captured = capturedFindings(unit, resolveEntry(row.entry.id, `${path}.entry.id`), row.entry.version);
    if (captured === null) return refusal("work_record_disposition_source_not_review_material", `${path}.entry`,
      "the named entry version is not an immutable capture of authenticated review findings on this unit");
    let selection;
    if (row.finding_id !== undefined) {

      const normalized = normalizeAdvisoryDispositions([{ review_run_id: captured.run_id, finding_id: row.finding_id,
        disposition: row.disposition }], { reviews: [{ run_id: captured.run_id, findings: captured.findings }] });
      if (normalized === null) return refusal("work_record_disposition_finding_unknown", `${path}.finding_id`,
        "the captured run lists no producer finding with this id; select the exact advisory text instead");
      selection = { finding_id: row.finding_id };
    } else {
      const extent = selectExtent(captured, row.selected_text, path);
      if (!extent.ok) return extent;
      selection = extent.selection;
    }
    const created = { id: (nextId += 1), review_run_id: captured.run_id,
      entry: { entry_id: captured.entry_id, version_id: captured.version_id }, selection,
      disposition: row.disposition, ...(row.rationale === undefined ? {} : { rationale: row.rationale }) };
    if (touched.has(occurrenceKey(created)) || next.some((candidate) => occurrenceKey(candidate) === occurrenceKey(created))) {
      return refusal("work_record_disposition_occurrence_duplicate", path,
        "this occurrence already has a judgment; change that judgment by its id instead of adding another");
    }
    touched.add(occurrenceKey(created));
    next.push(created);
    bind(row.key, created.id);
  }
  if (JSON.stringify(next) === JSON.stringify(saved)) return { ok: true, record, changedFields: [] };
  unit.sections = { ...unit.sections, dispositions: next };
  return { ok: true, record: updated,
    changedFields: [`${sliceId === null ? "" : `slices[${sliceId}].`}sections.dispositions`] };
}

export async function readSavedReviewDispositions({ capturedUnit, expectedRevision = null, deliveryIdentity = null },
  { loadRecord = loadWorkRecordById } = {}) {
  const { repoRoot, unit } = capturedUnit ?? {};
  const [recordId, sliceId = null] = typeof unit === "string" ? unit.split("#") : [];
  const delivery = deliveryIdentity === null ? {} : { delivery_identity: structuredClone(deliveryIdentity) };
  let loaded;
  try {
    loaded = await loadRecord({ dir: repoRoot, id: recordId });
  } catch (error) {
    return { state: "unavailable", unit, ...delivery,
      cause: { code: error?.code ?? "work_record_load_failed", message: error?.message ?? null } };
  }
  const selected = loaded?.valid === true && loaded.record ? selectUnit(loaded.record, sliceId) : null;
  if (selected === null) {
    const first = loaded?.diagnostics?.find((entry) => entry.severity === "error") ?? loaded?.diagnostics?.[0];
    return { state: "unavailable", unit, ...delivery, cause: { code: first?.code ?? "work_record_unit_unavailable",
      message: first?.message ?? "the selected unit is not an existing valid canonical unit" } };
  }
  const source = { unit, revision: computeWorkRecordSourceDigest(loaded.record) };
  if (expectedRevision !== null && expectedRevision !== source.revision) {
    return { state: "source_mismatch", unit, ...delivery, expected_revision: expectedRevision,
      current_revision: source.revision };
  }
  const rows = Array.isArray(selected.sections?.dispositions) ? structuredClone(selected.sections.dispositions) : [];
  const checked = validateSavedSources(selected, rows);
  if (!checked.ok) {
    const { code, path, message } = checked.diagnostics[0];
    return { state: "unavailable", unit, ...delivery, cause: { code, path, message } };
  }
  return rows.length === 0 ? { state: "absent", source, ...delivery }
    : { state: "present", source, ...delivery, rows };
}
