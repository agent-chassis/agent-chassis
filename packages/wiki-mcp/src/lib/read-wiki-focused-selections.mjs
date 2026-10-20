

import { isDeepStrictEqual } from 'node:util';
import { projectMarkdownPassages } from '@agent-chassis/wiki-core/src/lib/search-passages.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function matchesAuthoredPattern(value, pattern) {
  if (!object(pattern)) return isDeepStrictEqual(value, pattern);
  const absent = pattern.absent ?? [];
  if (!Array.isArray(absent) || absent.some(path => typeof path !== 'string' || !path.length))
    throw Object.assign(new Error('absent must name authored field paths.'), { code: 'selection_pattern_invalid' });
  for (const path of absent) {
    const parts = path.split('.');
    let held = value, supplied = pattern;
    for (const part of parts) {
      held = object(held) && Object.hasOwn(held, part) ? held[part] : undefined;
      supplied = object(supplied) && Object.hasOwn(supplied, part) ? supplied[part] : undefined;
    }
    if (supplied !== undefined) throw Object.assign(new Error(`absent contradicts supplied ${path}.`), { code: 'selection_pattern_invalid' });
    if (held !== undefined) return false;
  }
  return Object.entries(pattern).filter(([key]) => key !== 'absent').every(([key, expected]) =>
    object(value) && Object.hasOwn(value, key) && (object(expected)
      ? matchesAuthoredPattern(value[key], expected) : isDeepStrictEqual(value[key], expected)));
}

export function markAmbiguous(members) {
  return members.map(member => ({ ...member,
    ...(member.match !== undefined && members.filter(other => isDeepStrictEqual(other.match, member.match)).length > 1 ? { choice_state: 'ambiguous' } : {}) }));
}

function selectedIndex(meanings, match, refuse, choices) {
  const matches = meanings.flatMap((meaning, index) => matchesAuthoredPattern(meaning, match) ? [index] : []);
  if (matches.length !== 1) throw refuse(matches.length ? 'selection_ambiguous' : 'selection_not_found', {
    match, ...(matches.length ? { choices: matches.map(index => choices[index]),
      uncertainty: 'No item was selected; supply distinguishing authored meaning. Identical meaning cannot be narrowed by storage order.' } : {}) });
  return matches[0];
}

function readBinding(reference, select) {
  return { tool: 'workspace_read_wiki', reference, select,
    binding: 'Choose members[i].match; call {reads:[{reference,select:{...select,match:members[i].match}}]}. No item is selected by default.' };
}

export function readTaskSelection(tasks, select, reference, refuse) {
  const meanings = tasks.map(task => {
    const heading = /^\s*#{1,6}[\t ]+([^\r\n]+)(?:\r?\n|$)/u.exec(task.text);
    return { ...(heading ? { heading: heading[1] } : {}), text: task.text };
  });
  const members = meanings.map((meaning, index) => {
    const sameHeading = meanings.filter(other => other.heading === meaning.heading).length;
    const match = meaning.heading !== undefined && sameHeading === 1 ? { heading: meaning.heading } : meaning;
    return { match, status: tasks[index].status };
  });
  if (select.match !== undefined) {
    if (Object.keys(select.match).some(key => !['heading', 'text', 'absent'].includes(key)))
      throw refuse('selection_pattern_invalid', { cause: 'Task patterns admit heading, text and absent only.' });
    const index = selectedIndex(meanings, select.match, refuse, members);
    return { inventory: 'tasks', task: tasks[index] };
  }
  return { inventory: 'tasks', members: markAmbiguous(members),
    ...(members.length ? { selection_context: readBinding(reference, { inventory: 'tasks' }) } : {}) };
}

export function readDocumentSections({ markdown, body, title, source }, select, reference, refuse) {
  const stack = [];
  const passages = projectMarkdownPassages({ capture: { text: markdown, relativePath: source },
    page: { body, title }, pageKind: 'document' }).map(passage => {
    const level = /^(#{2,6})[\t ]/u.exec(passage.originalText)?.[1].length;
    if (level !== undefined) {
      while (stack.length && stack.at(-1).level >= level) stack.pop();
      stack.push({ level, heading: passage.heading });
    }
    return { heading: passage.heading, heading_path: level === undefined ? [passage.heading] : stack.map(item => item.heading),
      text: passage.originalText };
  });
  const members = passages.map(passage => {
    const match = { heading_path: passage.heading_path };
    if (passages.filter(other => isDeepStrictEqual(other.heading_path, passage.heading_path)).length > 1) match.text = passage.text;
    return { match };
  });
  if (select.match !== undefined) {
    if (Object.keys(select.match).some(key => !['heading', 'heading_path', 'text', 'absent'].includes(key)))
      throw refuse('selection_pattern_invalid', { cause: 'Section patterns admit heading, heading_path, text and absent only.' });
    const passage = passages[selectedIndex(passages, select.match, refuse, members)];
    return { field: select.field, view: 'sections', heading: passage.heading, value: passage.text };
  }
  return { field: select.field, view: 'sections', members: markAmbiguous(members),
    ...(members.length ? { selection_context: readBinding(reference, { field: select.field, view: 'sections' }) } : {}) };
}
