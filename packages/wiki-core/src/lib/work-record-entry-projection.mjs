import { utf8Length, workRecordEntryVersionFormat } from "./work-record-entry-schema.mjs";
import { encodeWorkRecordEntryReference, resolveWorkRecordEntryContent } from
  "./work-record-entry-content.mjs";

export function projectWorkRecordEntries(unit, { includeBody = false, offset = 0, limit = 25 } = {}) {
  const entries = Array.isArray(unit?.sections?.entries) ? unit.sections.entries : [];
  const rows = entries.slice(offset, offset + limit).map(entry => {
    const version = entry.versions.find(value => value.id === entry.current_version);
    return { entry_id: entry.id, current_version: entry.current_version, title: version?.title ?? null,
      kind: version?.kind ?? null, version_count: entry.versions.length,
      ...(includeBody ? { content: version?.content ?? null } : {}) };
  });
  return { offset, limit, total_count: entries.length, returned_count: rows.length,
    has_more: offset + rows.length < entries.length,
    entries: rows, metadata_bytes: utf8Length(JSON.stringify(rows)) };
}

export async function projectWorkRecordEntrySearchSources({
  record,
  repository,
  dir,
  history = false,
  loadWorkRecordById
}) {
  if (!record || typeof record !== "object" || typeof record.id !== "string") {
    throw new TypeError("record must be a canonical work record");
  }
  if (typeof repository !== "string" || repository.length === 0) {
    throw new TypeError("repository must be a nonempty string");
  }
  if (history !== false && history !== true) throw new TypeError("history must be a boolean");
  if (typeof loadWorkRecordById !== "function") throw new TypeError("loadWorkRecordById is required");

  const descriptors = [];
  const diagnostics = [];
  const units = [{ owner: record, sliceId: null },
    ...(record.slices ?? []).map(owner => ({ owner, sliceId: owner.id }))];
  for (const { owner, sliceId } of units) {
    const unit = sliceId === null ? record.id : `${record.id}#${sliceId}`;
    for (const entry of owner.sections?.entries ?? []) {
      const versions = history
        ? entry.versions
        : entry.versions.filter(version => version.id === entry.current_version);
      for (const version of versions) {
        const resolved = await resolveWorkRecordEntryContent({ content: version.content,
          repository, dir, loadWorkRecordById });
        const identity = { unit, entry_id: entry.id, version_id: version.id };
        if (!resolved.ok) {
          diagnostics.push({ ...resolved.diagnostic, ...identity });
          continue;
        }

        const format = workRecordEntryVersionFormat(entry, version);
        if (format === null || (format === "current" && (resolved.scalar_length !== version.scalar_length ||
            resolved.utf8_bytes !== version.utf8_bytes))) {
          diagnostics.push({ code: "work_record_entry_history_corrupt", severity: "error",
            authority_limb: "mechanical",
            message: "immutable version length metadata does not match rendered content", ...identity });
          continue;
        }
        const rootIdentity = { repository, unit, entry_id: entry.id, version_id: version.id,
          content_digest: resolved.content_digest };
        const seen = new Set([`${repository}\u0000${unit}\u0000${entry.id}\u0000${version.id}`]);
        const sourceClosure = [rootIdentity];
        for (const identity of resolved.source_closure) {
          const key = `${identity.repository}\u0000${identity.unit}\u0000${identity.entry_id}\u0000${identity.version_id}`;
          if (!seen.has(key)) { seen.add(key); sourceClosure.push(identity); }
        }
        descriptors.push({ kind: "work_record_entry", unit, entry_id: entry.id,
          version_id: version.id, title: version.title, entry_kind: version.kind,
          original_text: resolved.value, scalar_length: resolved.scalar_length,
          utf8_bytes: resolved.utf8_bytes,
          reference: encodeWorkRecordEntryReference({ repository, recordId: record.id,
            sliceId, entryId: entry.id, versionId: version.id, offset: 0,
            length: resolved.scalar_length, total: resolved.scalar_length }),
          source_closure: sourceClosure });
      }
    }
  }
  return { descriptors, diagnostics };
}
