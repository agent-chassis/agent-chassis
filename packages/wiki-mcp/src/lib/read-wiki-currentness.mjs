

import { compareObservedWorkRecords } from './work-record-read-tools.mjs';

export async function readWikiCurrentness({ dir, entries, readRecord, scope, contextCall }) {
  const affected = [];
  for (let offset = 0; offset < entries.length;) {
    const compared = await compareObservedWorkRecords({ dir, entries: entries.slice(offset), readRecord });
    if (!compared.results.length) throw new TypeError('read_wiki_currentness_no_progress');
    for (const row of compared.results) {
      if (row.state === 'unchanged') continue;
      const { observed_source_digest: _observed, current_source_digest: _current,
        diagnostic_codes: _codes, ...meaning } = row;
      affected.push(meaning);
    }
    offset += compared.results.length;
  }
  const unavailable = affected.some(row => row.state !== 'changed');
  const changed = affected.some(row => row.state === 'changed');
  return { currentness: true, complete: true, scope,
    state: entries.length === 0 ? 'not_checked'
      : unavailable ? changed ? 'changed_with_unavailable_sources' : 'unavailable'
        : changed ? 'changed' : 'unchanged',
    ...(entries.length ? {} : { not_checked: 'This search selected no canonical work-record observations; document, DEC/IN and entry-version currentness is not established.' }),
    ...(affected.length ? { affected } : {}),
    next_calls: contextCall === null ? [] : affected.filter(row => row.state === 'changed').map(row => contextCall(row.id)) };
}
