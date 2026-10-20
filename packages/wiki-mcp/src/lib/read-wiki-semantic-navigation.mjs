

import { matchesAuthoredPattern, markAmbiguous } from './read-wiki-focused-selections.mjs';
export function scopeDirectory(value, directory, refuse) {
  if (!Array.isArray(value) || value.some(path => typeof path !== 'string'))
    throw refuse('scope_directory_requires_paths');
  const prefix = directory === '.' ? '' : `${directory}/`;
  const selected = value.filter(path => path.startsWith(prefix));
  if (directory !== '.' && selected.length === 0) throw refuse('scope_directory_not_found');
  const files = [], directories = new Set();
  for (const path of selected) {
    const suffix = path.slice(prefix.length), slash = suffix.indexOf('/');
    if (slash === -1) files.push(path);
    else {
      const child = `${prefix}${suffix.slice(0, slash)}`;
      directories.add(child);
    }
  }
  return { directory, files, directories: [...directories].map(directory => ({ directory })) };
}

export function entryJson(text) {
  const start = /(?:^|\n)[\t ]*(?=[{[])/u.exec(text);
  if (!start) return { status: 'unstructured' };
  const offset = start.index + start[0].length;
  try {
    return { status: 'json', preamble: text.slice(0, offset), value: JSON.parse(text.slice(offset)) };
  } catch (error) {
    return { status: 'invalid_json', cause: error.message };
  }
}

export function entryNodeValue(document, path, refuse = reason => new TypeError(reason)) {
  if (document.status !== 'json') throw refuse('entry_structure_unavailable', { status: document.status, cause: document.cause });
  let value = document.value;
  for (const [depth, part] of path.entries()) {
    if (Array.isArray(value)) {
      if (part === null || typeof part !== 'object' || Array.isArray(part) || !Object.hasOwn(part, 'match'))
        throw refuse('selection_kind_mismatch', { path, resolved_path: path.slice(0, depth),
          cause: 'An array member requires an authored match pattern, not an index or stored identity.' });
      const matches = value.flatMap((row, index) => matchesAuthoredPattern(row !== null && typeof row === 'object' ? row : { value: row }, part.match) ? [index] : []);
      if (matches.length !== 1) throw refuse(matches.length ? 'selection_ambiguous' : 'entry_structure_member_not_found',
        { path, resolved_path: path.slice(0, depth),
          ...(matches.length ? { choices: entryMembers(matches.map(index => value[index])),
            uncertainty: 'No member selected; identical public meaning cannot be narrowed by storage order.' } : {}) });
      const index = matches[0];
      value = value[index];
    } else if (value !== null && typeof value === 'object' && Object.hasOwn(value, part)) value = value[part];
    else throw refuse('entry_structure_member_not_found', { path, resolved_path: path.slice(0, depth) });
  }
  return value;
}

function entryMembers(value) {
  return markAmbiguous(value.map(row => {
    if (row !== null && typeof row === 'object' && !Array.isArray(row)) {
      const match = {};
      const fields = [...new Set(['title', 'name', 'heading', ...Object.keys(row).filter(key => key === 'id' || key.endsWith('_id'))])];
      for (const key of fields) if (typeof row[key] === 'string') {
        match[key] = row[key];
        if (value.filter(other => matchesAuthoredPattern(other, match)).length === 1) return { match };
      }

      return { ...(Object.keys(match).length ? { match } : {}), fields: Object.keys(row),
        choice_state: Object.keys(match).length ? 'ambiguous' : 'caller_pattern_required' };
    }
    return { match: { value: row } };
  }));
}

export function entryNode(document, path, refuse) {
  const value = entryNodeValue(document, path, refuse);
  const members = Array.isArray(value) ? entryMembers(value)
    : value !== null && typeof value === 'object' ? Object.keys(value).map(name => ({ name })) : [];
  return { path, ...(members.length ? { members, complete: false } : { value, complete: true }) };
}
