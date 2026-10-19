

const RECORD = /^(?:WK|IN|DEC)-[0-9]{4}$/u;
const DOCUMENT = /^(?:docs|wiki)\/.+\.md$/u;
const PREPARATION_DIAGNOSTICS = new Set([
  'search_source_hashing_required', 'index_missing', 'index_version_mismatch', 'source_signature_mismatch'
]);

export function searchSourceSubject(member) {
  if (typeof member.source?.unit === 'string') return member.source.unit;
  if (RECORD.test(member.id)) return member.id;
  return DOCUMENT.test(member.relativePath) ? member.relativePath : null;
}

export function searchPathSubject(path) {
  if (DOCUMENT.test(path)) return path;
  return /^wiki\/(?:work-records\/WK|initiatives\/IN|decisions\/DEC)-[0-9]{4}\.json$/u.test(path)
    ? path.slice(path.lastIndexOf('/') + 1, -5) : null;
}

function excerpt(text, query) {
  const scalars = Array.from(text);
  const needle = query?.trim().split(/\s+/u).find(word => text.toLowerCase().includes(word.toLowerCase()));
  const match = needle === undefined ? 0 : Array.from(text.slice(0, text.toLowerCase().indexOf(needle.toLowerCase()))).length;
  const start = Math.max(0, match - 60), end = Math.min(scalars.length, start + 180);
  return `${start ? '…' : ''}${scalars.slice(start, end).join('')}${end < scalars.length ? '…' : ''}`;
}

export function searchChoice(member, query, contextCall) {
  const subject = searchSourceSubject(member);
  return { relativePath: member.relativePath, title: member.title, heading: member.heading,
    excerpt: excerpt(member.text, query),
    source: { kind: member.source.kind, reference: member.source.reference,
      ...(member.source.location === undefined ? {} : { location: Object.fromEntries(Object.entries(member.source.location)
        .filter(([key]) => ['kind', 'pointer', 'section_ordinal'].includes(key))) }),
      ...(member.source.unit === undefined ? {} : { unit: member.source.unit,
        entry_id: member.source.entry_id, version_id: member.source.version_id }) },
    ...(subject === null ? {} : { context: contextCall(subject) }) };
}

export function searchLimitations(inventory) {
  const limitations = (inventory.diagnostics ?? []).filter(row => !PREPARATION_DIAGNOSTICS.has(row.code));
  return limitations.length ? { limitations } : {};
}
