

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { isMap, isScalar, parseDocument, visit } from 'yaml';
import { reportedTestFailureLocation } from '../workspace-agent-test-proof-error-diagnostic.mjs';

const unavailable = reason => ({ state: 'unavailable', reason,
  uncertainty: 'The native process outcome stands; this capture does not establish the failing assertion or its cause.',
  stopping_condition: 'Do not infer a cause from other output or execute again merely to recover this historical diagnosis.' });

function diagnosed(failures, reason) {
  if (!failures.some(row => row.error !== undefined)) return {
    ...unavailable(reason ?? 'native_failure_report_unavailable'),
    ...(failures.length === 0 ? {} : { failures }) };
  return { state: reason === undefined ? 'captured' : 'partial', failures,
    ...(reason === undefined ? {} : { reason,
      uncertainty: 'These diagnoses were reported; other failing causes or error relationships could not be decoded.' }) };
}

function checkoutRoot(identity) {
  const cwd = identity?.invocation?.cwd;
  const project = identity?.project;
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || typeof project !== 'string') return undefined;
  return project === '.' ? cwd : path.resolve(cwd, ...project.split('/').map(() => '..'));
}

function testLocation(value, root) {
  if (typeof value !== 'string') return undefined;
  const match = /^(.*):(\d+):(\d+)$/u.exec(value);
  if (match === null) return undefined;
  let file = match[1];
  if (file.startsWith('file://')) {
    try { file = fileURLToPath(file); } catch { return undefined; }
  }
  if (root !== undefined && path.isAbsolute(file)) {
    const relative = path.relative(root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    file = relative.split(path.sep).join('/');
  }
  return { file, line: Number(match[2]), column: Number(match[3]) };
}

function operand(node) {
  if (!isScalar(node)) return { format: 'native_yaml', display: node.toString() };
  if (node.type === 'PLAIN' && node.source === 'undefined') return { type: 'undefined' };
  if (node.type === 'PLAIN' && /^-?\d+n$/u.test(node.source)) return { type: 'bigint', value: node.source.slice(0, -1) };
  if (typeof node.value === 'number' && !Number.isFinite(node.value)) return {
    type: 'nonfinite_number', value: String(node.value) };
  if (typeof node.value === 'number' && Number.isInteger(node.value) && !Number.isSafeInteger(node.value)) {
    return { format: 'native_yaml', display: node.source };
  }
  return node.value;
}

function failureMeaning(document, name, root) {
  if (!isMap(document.contents)) return null;
  const field = key => document.get(key);
  const kind = field('failureType');
  if (typeof kind !== 'string') return null;

  if (kind === 'subtestsFailed') return { aggregate: true };
  const message = field('error');
  if (typeof message !== 'string' || message.length === 0) return null;
  const location = testLocation(field('location'), root);
  const stack = field('stack');
  const throwLocation = typeof stack !== 'string' ? undefined : reportedTestFailureLocation(undefined,
    stack.split('\n').map(line => `    at ${line.trim().replace(/^at /u, '')}`), root);
  const error = { message };
  for (const [source, target] of [['errorType', 'name'], ['code', 'code'], ['operator', 'operator']]) {
    if (typeof field(source) === 'string') error[target] = field(source);
  }
  if (throwLocation !== undefined) error.location = throwLocation;
  for (const key of ['expected', 'actual']) {
    if (document.has(key)) error[key] = operand(document.get(key, true));
  }
  return { test: { name, ...(location === undefined ? {} : { location }) },
    failure_type: kind, error };
}

function nodeTapDiagnosis(text, identity) {
  const lines = text.replace(/\r\n/gu, '\n').split('\n');
  if (lines[0] !== 'TAP version 13') return unavailable('native_failure_report_unavailable');
  const failures = [];
  let incomplete = !lines.some(line => /^1\.\.\d+\s*$/u.test(line));
  let unreadable = false;
  for (let index = 1; index < lines.length; index++) {
    const verdict = /^( *)not ok \d+ - (.+)$/u.exec(lines[index]);
    if (verdict === null) continue;
    if (/ # (?:TODO|SKIP)(?:\s|$)/iu.test(verdict[2])) continue;

    const indent = `${verdict[1]}  `;
    const missing = reason => failures.push({ test: { name: verdict[2] }, diagnosis_unavailable: reason });
    if (lines[index + 1] !== `${indent}---`) {
      incomplete = true; missing('native_failure_report_incomplete'); continue;
    }
    let end = index + 2;
    while (end < lines.length && lines[end] !== `${indent}...`) end++;
    if (end === lines.length || lines.slice(index + 2, end).some(line => line !== '' && !line.startsWith(indent))) {
      incomplete = true; missing('native_failure_report_incomplete'); continue;
    }
    const document = parseDocument(lines.slice(index + 2, end).map(line => line.slice(indent.length)).join('\n'),
      { prettyErrors: false, uniqueKeys: true });

    let aliases = false;
    visit(document, { Alias() { aliases = true; } });
    if (document.errors.length || document.warnings.length || aliases) {
      unreadable = true; missing('native_failure_report_unreadable'); index = end; continue;
    }
    const meaning = failureMeaning(document, verdict[2], checkoutRoot(identity));
    if (meaning === null) { unreadable = true; missing('native_failure_report_unreadable'); }
    else if (!meaning.aggregate) failures.push(meaning);
    index = end;
  }
  return diagnosed(failures, incomplete ? 'native_failure_report_incomplete'
    : unreadable ? 'native_failure_report_unreadable' : undefined);
}

function inspectedOperand(text) {
  if (text === 'undefined') return { type: 'undefined' };
  if (text === 'null') return null;
  if (text === 'true' || text === 'false') return text === 'true';
  if (/^-?\d+n$/u.test(text)) return { type: 'bigint', value: text.slice(0, -1) };
  if (['NaN', 'Infinity', '-Infinity'].includes(text)) return { type: 'nonfinite_number', value: text };
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(text)) {
    const value = Number(text);
    if (Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) {
      return Object.is(value, -0) ? { type: 'negative_zero' } : value;
    }
  }
  const quoted = /^'([^'\\]*)'$/su.exec(text);
  if (quoted !== null) return quoted[1];
  if (text.startsWith('"')) {
    try { return JSON.parse(text); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
  return { format: 'node_inspect', display: text };
}

function nodeSpecDiagnosis(text, identity) {
  const marker = '\n✖ failing tests:\n';

  const at = text.lastIndexOf(marker);
  if (at < 0) return unavailable('native_failure_report_unavailable');
  const blocks = [...text.slice(at + marker.length).matchAll(
    /^test at (.+)\n✖ (.+) \([\d.]+m?s\)\n([\s\S]*?)(?=^test at |$(?![\s\S]))/gmu)];
  const failures = [];
  let incomplete = blocks.length === 0;
  for (const block of blocks) {
    const lines = block[3].trimEnd().split('\n');
    const root = checkoutRoot(identity);
    const declaration = testLocation(block[1], root);
    const subject = { name: block[2], ...(declaration === undefined ? {} : { location: declaration }) };
    const missing = () => {
      incomplete = true;
      failures.push({ test: subject, diagnosis_unavailable: 'native_failure_report_incomplete' });
    };
    const header = /^  ([A-Za-z_$][\w$.]*)(?: \[([^\]\s]+)\])?: (.*)$/u.exec(lines[0]);

    if (header === null) { missing(); continue; }
    const frame = lines.findIndex(line => /^ {6}at /u.test(line));
    if (frame < 0) { missing(); continue; }
    const message = [header[3], ...lines.slice(1, frame).map(line => line.replace(/^  /u, ''))].join('\n').trimEnd();
    const error = { name: header[1], message, ...(header[2] === undefined ? {} : { code: header[2] }) };
    const location = reportedTestFailureLocation(undefined, lines.filter(line => /^ {6}at /u.test(line))
      .map(line => line.slice(2)), root);
    if (location !== undefined) error.location = location;
    const propertyBlock = lines.some(line => /^ {6}at /u.test(line) && line.endsWith(' {'));
    if (propertyBlock && lines.at(-1) !== '  }') {
      incomplete = true;
      failures.push({ test: subject, error });
      continue;
    }
    if (!propertyBlock && lines.slice(frame).some(line => line.trim() !== '' && !/^ {6}at /u.test(line))) incomplete = true;
    for (let index = frame; index < lines.length - 1; index++) {
      const property = /^ {4}(code|operator|expected|actual): (.*)$/u.exec(lines[index]);
      if (property === null) continue;
      let end = index + 1;
      while (end < lines.length - 1 && !/^ {4}\S[^\n]*: /u.test(lines[end])) end++;
      const value = [property[2], ...lines.slice(index + 1, end)].join('\n').replace(/,$/u, '');
      const decoded = inspectedOperand(value);
      if (['code', 'operator'].includes(property[1])) {
        if (typeof decoded === 'string') error[property[1]] = decoded;
        else incomplete = true;
      } else error[property[1]] = decoded;
      index = end - 1;
    }

    const causeAt = lines.findIndex(line => /^ {4}\[cause\]: /u.test(line));
    if (causeAt >= 0) {
      const cause = /^ {4}\[cause\]: ([A-Za-z_$][\w$.]*)(?: \[([^\]\s]+)\])?: (.*)$/u.exec(lines[causeAt]);
      if (cause !== null) error.cause = { name: cause[1], message: cause[3],
        ...(cause[2] === undefined ? {} : { code: cause[2] }) };
      incomplete = true;
    }
    if (lines.some(line => /^ {4}\[errors\]:/u.test(line))) incomplete = true;
    failures.push({ test: subject, error });
  }
  return diagnosed(failures, incomplete ? 'native_failure_report_incomplete' : undefined);
}

export function ordinaryTestSemanticDiagnosis(result) {
  if (result === null || result === undefined || result.ok === true) return null;
  if (result.status !== 'executed' || result.run?.ran !== true) return null;
  if (result.run.timed_out === true || result.run.cancelled === true) return unavailable('execution_interrupted');
  if (result.run.output_truncated === true) return unavailable('native_failure_capture_incomplete');
  if (result.identity?.runner !== 'node-test') return unavailable('native_failure_report_unsupported');
  if (typeof result.run.stdout !== 'string' || result.run.stdout.length === 0) return unavailable('native_failure_capture_unavailable');
  const text = stripVTControlCharacters(result.run.stdout).replace(/\r\n/gu, '\n');
  return text.startsWith('TAP version 13\n') ? nodeTapDiagnosis(text, result.identity) : nodeSpecDiagnosis(text, result.identity);
}
