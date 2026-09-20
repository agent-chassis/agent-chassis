

import { decodeWorkRecordEntryReference, resolveWorkRecordEntryContent } from
  "./work-record-entry-content.mjs";
import { utf8Length } from "./work-record-entry-schema.mjs";
import { loadWorkRecordById as defaultLoadWorkRecordById } from "./work-record-store.mjs";

export const WORK_RECORD_MATERIAL_REFERENCE_LIMIT = 16;
export const WORK_RECORD_MATERIAL_UTF8_BYTE_LIMIT = 65_536;

function diagnostic(code, message, path = "sections.material_refs") {
  return { code, severity: "error", authority_limb: "mechanical", message, path };
}

export function validateWorkRecordMaterialRefs(value, {
  path = "sections.material_refs",
  required = false,
  repository = undefined
} = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) {
    return [diagnostic("work_record_material_refs_invalid", "material_refs must be an array", path)];
  }
  if (value.length > WORK_RECORD_MATERIAL_REFERENCE_LIMIT) {
    return [diagnostic("work_record_material_ref_limit_exceeded",
      `effective assignment material accepts at most ${WORK_RECORD_MATERIAL_REFERENCE_LIMIT} references`, path)];
  }
  if (repository !== undefined && value.length > 0 &&
      (typeof repository !== "string" || repository.length === 0)) {
    return [missingRepository(path)];
  }
  const diagnostics = [];
  for (const [index, leaf] of value.entries()) {
    const leafPath = `${path}[${index}]`;
    if (!leaf || typeof leaf !== "object" || Array.isArray(leaf) ||
        Object.keys(leaf).length !== 1 || typeof leaf.ref !== "string" || leaf.ref.length === 0) {
      diagnostics.push(diagnostic("work_record_material_ref_invalid",
        "material references are closed objects containing exactly one nonempty ref", leafPath));
      continue;
    }
    const decoded = decodeWorkRecordEntryReference(leaf.ref);
    if (decoded === null) {
      diagnostics.push(diagnostic("work_record_material_ref_not_immutable_entry",
        "material_refs accepts only immutable work-record entry references", `${leafPath}.ref`));
    } else if (decoded.invalid) {
      diagnostics.push(diagnostic("work_record_material_ref_corrupt",
        "immutable entry reference is corrupt", `${leafPath}.ref`));
    } else if (repository !== undefined && decoded.r !== repository) {
      diagnostics.push(foreignRepository(`${leafPath}.ref`));
    }
  }
  return diagnostics;
}

function missingRepository(path) {
  return diagnostic("work_record_material_repository_unavailable",
    "assignment material requires the trusted configured repository identity", path);
}

function foreignRepository(path) {
  return diagnostic("work_record_material_source_denied",
    "material reference belongs to another repository", path);
}

export function effectiveWorkRecordMaterialRefs(record, selected = record) {
  const parent = Array.isArray(record?.sections?.material_refs)
    ? record.sections.material_refs : [];
  const local = selected === record ? [] : Array.isArray(selected?.sections?.material_refs)
    ? selected.sections.material_refs : [];
  const seen = new Set();
  const refs = [];
  for (const leaf of [...parent, ...local]) {
    if (typeof leaf?.ref !== "string" || seen.has(leaf.ref)) continue;
    seen.add(leaf.ref);
    refs.push({ ref: leaf.ref });
  }
  return refs;
}

function pathIsVisible(sourcePath, selected, record) {
  if (sourcePath === `wiki/work-records/${record.id}.json`) return true;
  const declared = [selected?.read_scope, selected?.repo_paths, selected?.write_scope]
    .flatMap((value) => Array.isArray(value) ? value : []);
  return declared.some((entry) => entry === sourcePath ||
    (typeof entry === "string" && entry.endsWith("/") && sourcePath.startsWith(entry)) ||
    (typeof entry === "string" && sourcePath.startsWith(`${entry}/`)));
}

function selectVersion(loaded, reference) {
  const owner = reference.u === null ? loaded?.record
    : loaded?.record?.slices?.find((slice) => slice?.id === reference.u);
  const entry = owner?.sections?.entries?.find((value) => value?.id === reference.e);
  return entry?.versions?.find((value) => value?.id === reference.n) ?? null;
}

export async function resolveWorkRecordEntryMaterial({
  record,
  selected = record,
  repository,
  dir = ".",
  loadWorkRecordById = defaultLoadWorkRecordById
} = {}) {
  const refs = effectiveWorkRecordMaterialRefs(record, selected);
  if (refs.length > WORK_RECORD_MATERIAL_REFERENCE_LIMIT) {
    return { ok: false, diagnostic: diagnostic("work_record_material_ref_limit_exceeded",
      `effective assignment material accepts at most ${WORK_RECORD_MATERIAL_REFERENCE_LIMIT} references`) };
  }

  if (refs.length > 0 && (typeof repository !== "string" || repository.length === 0)) {
    return { ok: false, diagnostic: missingRepository("sections.material_refs") };
  }
  const sourceIds = new Set();
  const cache = new Map();
  const guardedLoad = async ({ dir: sourceDir, id }) => {
    const sourcePath = `wiki/work-records/${id}.json`;
    if (!pathIsVisible(sourcePath, selected, record)) {
      return { valid: false, record: null, diagnostics: [diagnostic(
        "work_record_material_source_denied",
        `assignment scope does not declare ${sourcePath}`,
        "sections.material_refs"
      )] };
    }
    sourceIds.add(id);
    if (!cache.has(id)) cache.set(id, await loadWorkRecordById({ dir: sourceDir, id }));
    return cache.get(id);
  };
  const entries = [];
  let renderedBytes = 0;
  for (const [index, leaf] of refs.entries()) {
    const decoded = decodeWorkRecordEntryReference(leaf.ref);
    if (decoded === null || decoded.invalid) {
      return { ok: false, diagnostic: diagnostic("work_record_material_ref_corrupt",
        "material reference is not an intact immutable entry reference",
        `sections.material_refs[${index}].ref`) };
    }
    if (decoded.r !== repository) {
      return { ok: false, diagnostic: foreignRepository(`sections.material_refs[${index}].ref`) };
    }
    const loaded = await guardedLoad({ dir, id: decoded.w });
    if (!loaded?.valid || !loaded.record) {
      const denied = loaded?.diagnostics?.some((entry) => entry?.code === "work_record_material_source_denied");
      return { ok: false, diagnostic: denied ? loaded.diagnostics[0] : diagnostic(
        "work_record_material_source_unavailable", `material source ${decoded.w} is unavailable`,
        `sections.material_refs[${index}].ref`) };
    }
    const version = selectVersion(loaded, decoded);
    if (!version) {
      return { ok: false, diagnostic: diagnostic("work_record_material_source_unavailable",
        "referenced immutable entry version is unavailable", `sections.material_refs[${index}].ref`) };
    }
    const resolved = await resolveWorkRecordEntryContent({ content: leaf,
      repository, dir,
      loadWorkRecordById: guardedLoad });
    if (!resolved.ok) return resolved;
    renderedBytes += utf8Length(resolved.value);
    if (renderedBytes > WORK_RECORD_MATERIAL_UTF8_BYTE_LIMIT) {
      return { ok: false, diagnostic: diagnostic("work_record_material_bytes_limit_exceeded",
        `effective assignment material exceeds ${WORK_RECORD_MATERIAL_UTF8_BYTE_LIMIT} rendered UTF-8 bytes`) };
    }
    entries.push(Object.freeze({
      ref: leaf.ref,
      identity: Object.freeze({ repository: decoded.r, record_id: decoded.w,
        slice_id: decoded.u, entry_id: decoded.e, version_id: decoded.n,

        offset: decoded.o, length: decoded.historical ? resolved.scalar_length : decoded.l,
        total: decoded.historical ? resolved.scalar_length : decoded.t }),
      provenance: structuredClone(version.provenance),
      text: resolved.value,
      utf8_bytes: utf8Length(resolved.value)
    }));
  }
  return Object.freeze({
    ok: true,
    schema_version: "work-record-entry-material.v1",
    reference_count: entries.length,
    rendered_utf8_bytes: renderedBytes,
    entries: Object.freeze(entries),
    source_record_ids: Object.freeze([...sourceIds])
  });
}
