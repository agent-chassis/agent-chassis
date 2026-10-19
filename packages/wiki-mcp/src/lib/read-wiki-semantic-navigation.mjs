

export function scopeDirectory(value, directory, refuse) {
  if (!Array.isArray(value) || value.some(path => typeof path !== 'string'))
    throw refuse('scope_directory_requires_paths');
  const prefix = directory === '.' ? '' : `${directory}/`;
  const selected = value.filter(path => path.startsWith(prefix));
  if (directory !== '.' && selected.length === 0) throw refuse('scope_directory_not_found');
  const files = [], directories = new Map();
  for (const path of selected) {
    const suffix = path.slice(prefix.length), slash = suffix.indexOf('/');
    if (slash === -1) files.push(path);
    else {
      const child = `${prefix}${suffix.slice(0, slash)}`;
      directories.set(child, (directories.get(child) ?? 0) + 1);
    }
  }
  return { directory, total_count: selected.length, files,
    directories: [...directories].map(([directory, count]) => ({ directory, count })) };
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

function rowKey(rows) {
  if (!rows.length || rows.some(row => row === null || typeof row !== 'object' || Array.isArray(row))) return null;
  const keys = Object.keys(rows[0]).filter(key => key === 'id' || key.endsWith('_id'));
  return keys.find(key => rows.every(row => typeof row[key] === 'string') &&
    new Set(rows.map(row => row[key])).size === rows.length) ?? null;
}

export function entryNodeValue(document, path, refuse = reason => new TypeError(reason)) {
  if (document.status !== 'json') throw refuse('entry_structure_unavailable', { status: document.status, cause: document.cause });
  let value = document.value;
  for (const part of path) {
    if (Array.isArray(value)) {
      const key = rowKey(value);
      if (key === null) throw refuse('entry_structure_has_no_row_identity', { path });
      const row = value.find(row => row[key] === part);
      if (row === undefined) throw refuse('entry_structure_member_not_found', { path });
      value = row;
    } else if (value !== null && typeof value === 'object' && Object.hasOwn(value, part)) value = value[part];
    else throw refuse('entry_structure_member_not_found', { path });
  }
  return value;
}

export function entryNode(document, path, refuse) {
  const value = entryNodeValue(document, path, refuse);
  const key = Array.isArray(value) ? rowKey(value) : null;
  const members = key !== null ? value.map(row => {
    const label = [row.title, row.name, row.statement, row.meaning].find(value => typeof value === 'string');
    return { name: row[key], identity_key: key,
      ...(label === undefined ? { description_state: 'not_recorded' } : { label }) };
  })
    : value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).map(name => ({ name })) : [];
  return { path,
    ...(members.length ? { members, complete: false }
      : Array.isArray(value) && value.length ? { item_count: value.length, complete: false,
        focused_selection: 'unavailable_without_named_row_identity' }
        : { value, complete: true }) };
}
