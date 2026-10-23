

import { stripVTControlCharacters } from 'node:util';

function linesOf(text) {
  const lines = [];
  for (let start = 0; start < text.length;) {
    const newline = text.indexOf('\n', start);
    const end = newline < 0 ? text.length : newline + 1;
    lines.push({ start, end, text: stripVTControlCharacters(text.slice(start, end)).replace(/\r?\n$/u, '') });
    start = end;
  }
  return lines;
}

const SECTION = /^\s*(?:=+\s*)?(ERRORS|FAILURES)(?:\s*=+)?\s*$/u;
const VERDICT = /^(.+?)\s+\.{3}\s+FAILED(?:\s+\([^\n]*\))?\s*$/u;
const HEADING = /^(.+?)\s+=>\s+(.+:\d+:\d+)\s*$/u;
const EXCEPTION = /^(?:error:\s*|E\s+)?([A-Za-z_$][\w.$]*(?:Error|Exception)|Error|Exception)(?:\s+\[([^\]]+)\])?:\s*(.*)$/u;

export const nativeCorrectionLines = lines => lines.filter(line =>
  /^\s*(?:Correction|Required correction|Fix|Remedy|Action|Expected(?: string| pattern| substring)?|Actual|Received(?: string| pattern| substring)?|Caused by)[\t ]*:\s*\S/iu
    .test(stripVTControlCharacters(line)));

function statedError(lines) {

  const line = lines.find(line => /^error:\s*/u.test(line.text) && EXCEPTION.test(line.text)) ??
    lines.find(line => EXCEPTION.test(line.text));
  if (line === undefined) return null;
  const match = EXCEPTION.exec(line.text);
  const error = { name: match[1], message: match[3], ...(match[2] === undefined ? {} : { code: match[2] }) };
  const details = lines.slice(lines.indexOf(line) + 1);
  const corrections = nativeCorrectionLines(details.map(row => row.text))
    .filter(text => !/^\s*(?:Expected|Actual|Received)\s*:/iu.test(text));
  const subjects = details.filter(row => /^\s*(?:Source|Locator|Location)\s*:\s*\S/iu.test(row.text)).map(row => row.text);
  if (corrections.length || subjects.length) error.message = [error.message, ...subjects, ...corrections].join('\n');
  for (const row of details) {
    const value = /^\s*(Expected|Actual|Received)\s*:\s*(.*)$/iu.exec(row.text);
    if (value !== null) error[value[1].toLowerCase() === 'expected' ? 'expected' : 'actual'] = {
      format: 'native_display', display: value[2] };
  }
  return { error, start: line.start, frames: lines.map(line => line.text).filter(line => /^\s+at /u.test(line)) };
}

export function nativeTextFailureReport(text) {
  if (typeof text !== 'string') return null;
  const lines = linesOf(text);
  const sections = lines.flatMap((line, index) => SECTION.test(line.text) ? [{ index, kind: SECTION.exec(line.text)[1] }] : []);
  const section = sections.filter(row => row.kind === 'ERRORS').at(-1);
  if (section === undefined) return null;
  const verdicts = lines.slice(0, section.index).flatMap(line => {
    const verdict = VERDICT.exec(line.text);
    return verdict === null ? [] : [{ name: verdict[1].trim(), start: line.start, end: line.end }];
  });
  if (!verdicts.length) return null;
  const endIndex = sections.find(row => row.index > section.index)?.index ?? lines.length;
  const headings = lines.slice(section.index + 1, endIndex).flatMap(line => {
    const heading = HEADING.exec(line.text);
    return heading === null ? [] : [{ name: heading[1].trim(), location: heading[2], line }];
  });
  const failures = verdicts.map(verdict => {
    const matches = headings.filter(row => row.name === verdict.name);

    const heading = matches.length === 1 && verdicts.filter(row => row.name === verdict.name).length === 1 ? matches[0] : null;
    if (heading === null) return { ...verdict, diagnosis_unavailable: 'native_failure_attribution_unavailable' };
    const next = headings.find(row => row.line.start > heading.line.start)?.line.start ?? lines[endIndex]?.start ?? text.length;
    const body = lines.filter(line => line.start >= heading.line.end && line.start < next);
    const stated = statedError(body);
    return { name: verdict.name, location: heading.location, start: stated?.start ?? heading.line.start, end: next,
      context: heading.line.text, ...(stated === null ? { diagnosis_unavailable: 'native_failure_report_incomplete' }
        : { error: stated.error, frames: stated.frames }) };
  });
  const summary = [...stripVTControlCharacters(text).matchAll(/^\s*(?:FAILED|FAIL)\s*\|[^\n]*\b(\d+) failed\b/gmu)].at(-1);
  return { failures, complete: summary !== undefined && Number(summary[1]) === failures.length };
}

export function nativeLoadingFailureReport(text) {
  if (typeof text !== 'string') return null;
  const lines = linesOf(text);
  const first = lines.find(line => line.text.trim() !== '');
  const header = /^([\w.]+(?:Error|Exception)|Error|Exception) while (loading|importing) .+? ['"]([^'"\n]+)['"]\.?$/u.exec(first?.text ?? '');
  if (header === null) return null;
  const errors = lines.filter(line => /^E\s+/u.test(line.text) && EXCEPTION.test(line.text));
  if (errors.length !== 1) return null;
  const stated = statedError(errors);
  const frames = lines.flatMap(line => {
    const frame = /^(.*):(\d+): in \S/u.exec(line.text);
    return frame === null ? [] : [{ file: frame[1], line: Number(frame[2]) }];
  });
  return { operation: { phase: header[2], subject: header[3] },
    failure_type: 'startup', error: { ...stated.error,
      ...(frames.length === 0 ? {} : { location: frames.at(-1) }) } };
}
